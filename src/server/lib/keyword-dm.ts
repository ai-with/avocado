// F-64 댓글 키워드 자동 DM. 웹훅 댓글 → 규칙 매칭 → 비공개 답장 1건 (C1-a)
import { and, asc, count, eq, gte, isNull, or, sql } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { guides, igConnections, influencers, keywordDmRules, keywordDmSends, shortLinks, workspaces } from "../db/schema";
import { matchKeyword, PRIVATE_REPLY_HOURLY_LIMIT, PRIVATE_REPLY_WINDOW_MS, renderDm, HOUR, type KeywordDmSendStatus } from "../../shared/performance";
import { decryptToken } from "./crypto";
import { sendPrivateReply, sendPublicReply, tokenKey } from "./instagram";
import { createShortLinks } from "./links";
import { logEvent } from "./events";
import { newId, now } from "./ids";
import { definitiveIgDisconnect, igConnectionState, igConnectionUsable, igGrantVerified } from "./ig-connection-state";
import { disconnectIgConnection } from "./ig-disconnect-mail";
import { productionDmPolicy, type DmPolicy } from "./message-policy";
import { claimDmAttempt, DM_ATTEMPT_RECOVERY_MS, dmAttemptCurrent, dmRuleHmac, resolveDmConsent, storedDmConsentReason, unverifiedDmRecipient, type DmRecipientVerifier } from "./dm-consent";

type Rule = typeof keywordDmRules.$inferSelect;
type Send = typeof keywordDmSends.$inferSelect;
type DmProvider = { privateReply: typeof sendPrivateReply; publicReply: typeof sendPublicReply };
type Dependencies = { policy: DmPolicy; provider: DmProvider; verifyRecipient: DmRecipientVerifier };

function blockStatements(db: Db, rows: { rule: Rule; sendId: string }[], at: number) {
  const candidates = JSON.stringify(rows.map(({ rule, sendId }) => ({ sendId, ruleId: rule.id, workspaceId: rule.workspaceId })));
  return [
    db.$client.prepare(`UPDATE keyword_dm_sends AS s SET reason=CASE WHEN s.status='sending' THEN 'delivery_outcome_unknown' ELSE 'send_policy_unconfigured' END,
      status=CASE WHEN s.status='sending' THEN 'unknown' ELSE 'failed' END WHERE (s.status='queued' OR (s.status='sending' AND s.dm_attempt_at<=?))
      AND EXISTS(SELECT 1 FROM json_each(?) c JOIN keyword_dm_rules r ON r.id=json_extract(c.value,'$.ruleId')
        WHERE s.id=json_extract(c.value,'$.sendId') AND s.rule_id=r.id AND r.workspace_id=json_extract(c.value,'$.workspaceId'))`).bind(at - DM_ATTEMPT_RECOVERY_MS, candidates),
    // Deterministic event IDs make a concurrent/lost-response replay idempotent.
    db.$client.prepare(`INSERT OR IGNORE INTO events(id,workspace_id,name,props,at)
      SELECT 'keyword_dm_policy_blocked:'||s.id,r.workspace_id,'keyword_dm_failed',json_object('rule_id',r.id,'reason',s.reason),?
      FROM json_each(?) c JOIN keyword_dm_sends s ON s.id=json_extract(c.value,'$.sendId') AND s.rule_id=json_extract(c.value,'$.ruleId')
      JOIN keyword_dm_rules r ON r.id=s.rule_id AND r.workspace_id=json_extract(c.value,'$.workspaceId')
      WHERE (s.status='failed' AND s.reason='send_policy_unconfigured') OR (s.status='unknown' AND s.reason='delivery_outcome_unknown')`).bind(at, candidates),
  ];
}
async function blockUnconfigured(db: Db, rule: Rule, sendId: string): Promise<KeywordDmSendStatus> {
  await db.$client.batch(blockStatements(db, [{ rule, sendId }], now()));
  return "failed";
}

// 규칙의 인플루언서 ig_comment_dm 링크. 없으면 같은 가이드·인플루언서(없으면 가이드)의 다른 링크 목적지로 만든다
export async function ensureCommentDmLink(db: Db, rule: Pick<Rule, "workspaceId" | "guideId" | "influencerId">) {
  if (!rule.guideId) return null;
  const live = await db
    .select()
    .from(shortLinks)
    .where(and(eq(shortLinks.workspaceId, rule.workspaceId), eq(shortLinks.guideId, rule.guideId), isNull(shortLinks.deletedAt)))
    .orderBy(asc(shortLinks.createdAt));
  const mine = live.filter((l) => l.influencerId === rule.influencerId);
  const hit = mine.find((l) => l.channelKey === "ig_comment_dm");
  if (hit) return hit;
  const src = mine[0] ?? live[0];
  if (!src) return null;
  const g = await db.select({ slug: guides.slug }).from(guides).where(eq(guides.id, rule.guideId)).get();
  const inf = rule.influencerId ? await db.select({ handle: influencers.igHandle }).from(influencers).where(eq(influencers.id, rule.influencerId)).get() : null;
  await createShortLinks(db, {
    workspaceId: rule.workspaceId,
    guideId: rule.guideId,
    guideSlug: g?.slug ?? "",
    targets: [{ influencerId: rule.influencerId, handle: inf?.handle ?? null }],
    channelKeys: ["ig_comment_dm"],
    destination: { type: src.destinationType, id: src.destinationId, url: src.destinationUrl },
  });
  return (
    (await db
      .select()
      .from(shortLinks)
      .where(and(eq(shortLinks.guideId, rule.guideId), eq(shortLinks.channelKey, "ig_comment_dm"), rule.influencerId ? eq(shortLinks.influencerId, rule.influencerId) : isNull(shortLinks.influencerId), isNull(shortLinks.deletedAt)))
      .get()) ?? null
  );
}

export type IgComment = { id: string; text: string; from: { id: string; username?: string }; media: { id: string } };

// 토큰이 살아 있는 연결만. 끊겼거나 만료면 null
async function usableConnection(db: Db, env: Env, rule: Rule) {
  const conn = rule.igConnectionId ? await db.select().from(igConnections).where(and(eq(igConnections.id, rule.igConnectionId), eq(igConnections.workspaceId, rule.workspaceId), eq(igConnections.target, "brand_sender"))).get() : null;
  const state = igConnectionState(conn);
  if (conn && igGrantVerified(conn) && (state.reason === "expired" || state.reason === "token_missing")) await disconnectIgConnection(env, db, conn, state.reason);
  if (!conn?.igUserId || !igConnectionUsable(conn)) {
    await db.update(keywordDmRules).set({ status: "paused", enabled: false, pausedReason: state.reason ?? "not_connected", updatedAt: now() })
      .where(and(eq(keywordDmRules.id, rule.id), sql`${keywordDmRules.igConnectionId} IS ${rule.igConnectionId}`,
        conn ? sql`EXISTS(SELECT 1 FROM ig_connections g WHERE g.id=${conn.id} AND g.generation=${conn.generation})` : sql`1`));
    return null;
  }
  return { ...conn, tokenEnc: conn.tokenEnc!, igUserId: conn.igUserId };
}

// 시간당 750콜 (C1-b). 넘으면 대기열, cron 이 7일 창 안에서 다시 보낸다
async function sentLastHour(db: Db, connectionId: string) {
  const hour = await db
    .select({ n: count() })
    .from(keywordDmSends)
    .innerJoin(keywordDmRules, eq(keywordDmRules.id, keywordDmSends.ruleId))
    .where(and(eq(keywordDmRules.igConnectionId, connectionId), eq(keywordDmSends.status, "sent"), gte(keywordDmSends.sentAt, now() - HOUR)))
    .get();
  return hour?.n ?? 0;
}

// 한 건 발송 시도. 기록(keyword_dm_sends)은 호출 측이 만든 행을 갱신한다
async function deliver(db: Db, env: Env, rule: Rule, send: Send, { policy, provider, verifyRecipient }: Dependencies): Promise<KeywordDmSendStatus> {
  const sendId = send.id; let attempt: string | undefined;
  const set = async (status: KeywordDmSendStatus, reason: string | null, extra: { sentAt?: number; linkId?: string } = {}) => {
    const changed = await db.update(keywordDmSends).set({ status, reason, ...extra }).where(and(eq(keywordDmSends.id, sendId),
      attempt ? and(status === "sent" ? or(eq(keywordDmSends.status, "sending"), eq(keywordDmSends.status, "unknown")) : eq(keywordDmSends.status, "sending"),
        eq(keywordDmSends.dmAttemptToken, attempt)) : eq(keywordDmSends.status, "queued"))).returning({ id: keywordDmSends.id });
    if (!changed.length) {
      const current = await db.select({ status: keywordDmSends.status }).from(keywordDmSends)
        .where(and(eq(keywordDmSends.id, sendId), eq(keywordDmSends.ruleId, rule.id))).get();
      return current?.status ?? "unknown";
    }
    if (status === "sent") await logEvent(db, rule.workspaceId, "keyword_dm_sent", { rule_id: rule.id });
    if (status === "failed" || status === "expired" || status === "unknown") await logEvent(db, rule.workspaceId, "keyword_dm_failed", { rule_id: rule.id, reason });
    return status;
  };
  // Block before token decryption, link creation, disconnect mail or providers.
  if (!policy.configured) return blockUnconfigured(db, rule, sendId);
  if (now() - send.commentAt > PRIVATE_REPLY_WINDOW_MS) return set("expired", "older_than_7d");
  const denied = await storedDmConsentReason(db, rule, send);
  if (denied) return set("failed", denied);
  if (!send.dmRuleHmac || send.dmRuleHmac !== await dmRuleHmac(env, rule)) return set("failed", "dm_authority_changed");

  const key = tokenKey(env);
  const conn = await usableConnection(db, env, rule);
  if (!conn || !key) {
    return set("failed", "token_expired");
  }
  const resolved = await resolveDmConsent(db, env, { workspaceId: rule.workspaceId, connectionId: conn.id, connectionGeneration: conn.generation,
    senderAccountId: conn.igUserId, commentId: send.commentId, commentActorId: send.igUserId }, verifyRecipient);
  if (!resolved) return set("failed", "dm_identity_unverified");
  if (send.dmAppHmac !== resolved.binding.dmAppHmac || send.dmRecipientHmac !== resolved.binding.dmRecipientHmac || send.dmSenderGeneration !== resolved.binding.dmSenderGeneration)
    return set("failed", "dm_identity_unverified");
  if ((await sentLastHour(db, conn.id)) >= PRIVATE_REPLY_HOURLY_LIMIT) return set("queued", "hourly_limit");

  const link = await ensureCommentDmLink(db, rule);
  if (!link) return set("failed", "no_link");
  const ws = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, rule.workspaceId)).get();
  const token = await decryptToken(key, conn.tokenEnc);
  const text = renderDm(rule.message, `${env.PUBLIC_SHORT_BASE}/${link.slug}`, ws?.name ?? "");
  if (!policy.configured) return blockUnconfigured(db, rule, sendId);
  const claimed = await claimDmAttempt(db, rule, send, resolved.scope);
  if (!claimed.ok) return claimed.reason === "dm_already_attempted" ? "sending" : set("failed", claimed.reason);
  attempt = claimed.token;
  // The native claim is the final awaited permission check before the first
  // provider call. Revocation cannot undo an HTTP already started after it.
  if (!policy.configured) return set("failed", "send_policy_unconfigured");
  const r = await provider.privateReply(env, token, conn.igUserId, send.commentId, text);
  if (!r.ok) {
    if (r.reason === "send_policy_unconfigured") return set("failed", "send_policy_unconfigured");
    const reason = definitiveIgDisconnect(r);
    if (reason) await disconnectIgConnection(env, db, conn, reason);
    if (r.reason === "api_error") return set("unknown", "delivery_outcome_unknown", { linkId: link.id });
    return set("failed", r.reason, { linkId: link.id });
  }
  // A followup lookup/provider failure cannot erase confirmed private acceptance.
  // Recovery may have marked this exact in-flight attempt unknown while its
  // confirmed private ACK was delayed. Only that token can promote it to sent.
  const persisted = await set("sent", null, { sentAt: now(), linkId: link.id });
  if (persisted !== "sent") return persisted;
  try {
    if (policy.configured && rule.publicReplyVariants.length > 0) {
      const pick = rule.publicReplyVariants[Math.floor(Math.random() * rule.publicReplyVariants.length)];
      if (pick && await dmAttemptCurrent(db, rule, send, resolved.scope, attempt) && policy.configured) {
        const reply = await provider.publicReply(env, token, send.commentId, pick);
        if (!reply.ok) { const reason = definitiveIgDisconnect(reply); if (reason) await disconnectIgConnection(env, db, conn, reason); }
      }
    }
  } catch { console.warn("[keyword_dm_public_reply_failed]"); }
  return "sent";
}

// 웹훅 comments 한 건. igAccountId = entry.id (댓글이 달린 브랜드 계정)
async function handleCommentWith(db: Db, env: Env, igAccountId: string, comment: IgComment, commentAt: number, deps: Dependencies) {
  if (comment.from.id === igAccountId) return; // 브랜드 자신의 댓글(공개 답글 포함)
  const rules = await db
    .select({ rule: keywordDmRules, senderGeneration: igConnections.generation })
    .from(keywordDmRules)
    .innerJoin(igConnections, eq(igConnections.id, keywordDmRules.igConnectionId))
    .where(and(eq(keywordDmRules.igMediaId, comment.media.id), eq(keywordDmRules.status, "on"), eq(igConnections.igUserId, igAccountId),
      eq(igConnections.workspaceId, keywordDmRules.workspaceId), eq(igConnections.target, "brand_sender")));
  for (const { rule, senderGeneration } of rules) {
    if (!matchKeyword(comment.text, rule.keywords)) continue;
    const dup = await db.select({ id: keywordDmSends.id }).from(keywordDmSends).where(and(eq(keywordDmSends.ruleId, rule.id), eq(keywordDmSends.igUserId, comment.from.id),
      sql`NOT (${keywordDmSends.status}='failed' AND ${keywordDmSends.dmAttemptAt} IS NULL AND coalesce(${keywordDmSends.reason},'') IN
        ('send_policy_unconfigured','dm_identity_unverified','dm_consent_missing','dm_consent_revoked','dm_consent_stale','dm_consent_changed','dm_consent_removed','dm_authority_changed'))`)).get();
    const resolved = deps.policy.configured && !dup && rule.igConnectionId ? await resolveDmConsent(db, env, { workspaceId: rule.workspaceId,
      connectionId: rule.igConnectionId, connectionGeneration: senderGeneration, senderAccountId: igAccountId, commentId: comment.id, commentActorId: comment.from.id }, deps.verifyRecipient) : null;
    const ruleHmac = resolved ? await dmRuleHmac(env, rule) : null;
    const id = newId();
    const inserted = await db
      .insert(keywordDmSends)
      .values({ id, ruleId: rule.id, commentId: comment.id, igUserId: comment.from.id, username: comment.from.username ?? null, commentText: comment.text.slice(0, 500), commentAt, status: dup ? "already_sent" : "queued", reason: null, ...resolved?.binding, dmRuleHmac: ruleHmac })
      .onConflictDoNothing()
      .returning();
    // 같은 댓글 웹훅 재전송이면 무시, 같은 사람·게시물이면 already_sent 기록만
    if (inserted.length === 0 || dup) continue;
    await logEvent(db, rule.workspaceId, "keyword_dm_matched", { rule_id: rule.id });
    await deliver(db, env, rule, inserted[0]!, deps);
  }
}

// cron: 대기열(시간 한도·일시 오류) 재시도
async function retryQueuedWith(env: Env, deps: Dependencies): Promise<void> {
  const db = getDb(env.DB);
  const rows = await db
    .select({ send: keywordDmSends, rule: keywordDmRules })
    .from(keywordDmSends)
    .innerJoin(keywordDmRules, eq(keywordDmRules.id, keywordDmSends.ruleId))
    .where(or(and(eq(keywordDmSends.status, "queued"), eq(keywordDmRules.status, "on")), and(eq(keywordDmSends.status, "sending"), sql`${keywordDmSends.dmAttemptAt}<=${now() - DM_ATTEMPT_RECOVERY_MS}`)))
    .orderBy(asc(keywordDmSends.commentAt))
    .limit(100);
  if (!deps.policy.configured) {
    // Keep the existing 100-row bound within Free D1's invocation API budget.
    // Each status/audit pair remains atomic, with no repeat terminal receipt.
    if (rows.length) await db.$client.batch(blockStatements(db, rows.map(({ send, rule }) => ({ rule, sendId: send.id })), now()));
    return;
  }
  const abandoned = rows.filter(({ send }) => send.status === "sending");
  if (abandoned.length) await db.$client.batch(blockStatements(db, abandoned.map(({ send, rule }) => ({ rule, sendId: send.id })), now()));
  for (const { send, rule } of rows) if (send.status === "queued") await deliver(db, env, rule, send, deps);
}

// Only trusted server constructors can inject a test policy and fake provider.
// The real provider helpers independently enforce the production policy.
export function createKeywordDmSender(policy: DmPolicy = productionDmPolicy, provider: DmProvider = { privateReply: sendPrivateReply, publicReply: sendPublicReply }, verifyRecipient: DmRecipientVerifier = unverifiedDmRecipient) {
  const deps = { policy, provider, verifyRecipient };
  return {
    handleComment: async (db: Db, env: Env, account: string, comment: IgComment, at: number) => {
      try { await handleCommentWith(db, env, account, comment, at, deps); } catch { throw new Error("keyword_dm_processing_failed"); }
    },
    retryQueuedDms: async (env: Env) => {
      try { await retryQueuedWith(env, deps); } catch { throw new Error("keyword_dm_processing_failed"); }
    },
  };
}
export const { handleComment, retryQueuedDms } = createKeywordDmSender();
