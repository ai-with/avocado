// F-64 댓글 키워드 자동 DM. 웹훅 댓글 → 규칙 매칭 → 비공개 답장 1건 (C1-a)
import { and, asc, count, eq, gte, isNull } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { guides, igConnections, influencers, keywordDmRules, keywordDmSends, shortLinks, workspaces } from "../db/schema";
import { matchKeyword, PRIVATE_REPLY_HOURLY_LIMIT, PRIVATE_REPLY_WINDOW_MS, renderDm, HOUR, type KeywordDmSendStatus } from "../../shared/performance";
import { decryptToken } from "./crypto";
import { sendPrivateReply, sendPublicReply, tokenKey } from "./instagram";
import { createShortLinks } from "./links";
import { logEvent } from "./events";
import { sendEmail } from "./email";
import { memberEmails } from "./members";
import { newId, now } from "./ids";

type Rule = typeof keywordDmRules.$inferSelect;

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

async function notifyPaused(db: Db, env: Env, rule: Rule) {
  const rows = await memberEmails(db, rule.workspaceId, ["owner", "editor"]);
  for (const r of rows) {
    await sendEmail(env, {
      to: r.email,
      subject: "댓글 키워드 DM 규칙이 일시정지됐어요",
      text: `인스타그램 연결이 끊겨 규칙을 멈췄습니다. 연동 화면에서 다시 연결해 주세요.\n${env.APP_URL}/settings/integrations`,
      html: `<p>인스타그램 연결이 끊겨 규칙을 멈췄습니다. 연동 화면에서 다시 연결해 주세요.</p><p><a href="${env.APP_URL}/settings/integrations">연동 열기</a></p>`,
    });
  }
}

export type IgComment = { id: string; text: string; from: { id: string; username?: string }; media: { id: string } };

// 토큰이 살아 있는 연결만. 끊겼거나 만료면 null
async function usableConnection(db: Db, rule: Rule) {
  const conn = rule.igConnectionId ? await db.select().from(igConnections).where(eq(igConnections.id, rule.igConnectionId)).get() : null;
  if (!conn?.tokenEnc || !conn.igUserId || conn.revokedAt || (conn.expiresAt ?? 0) < now()) return null;
  return { ...conn, tokenEnc: conn.tokenEnc, igUserId: conn.igUserId };
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
async function deliver(db: Db, env: Env, rule: Rule, sendId: string, c: { commentId: string; commentAt: number }): Promise<KeywordDmSendStatus> {
  const set = async (status: KeywordDmSendStatus, reason: string | null, extra: { sentAt?: number; linkId?: string } = {}) => {
    await db.update(keywordDmSends).set({ status, reason, ...extra }).where(eq(keywordDmSends.id, sendId));
    if (status === "sent") await logEvent(db, rule.workspaceId, "keyword_dm_sent", { rule_id: rule.id });
    if (status === "failed" || status === "expired") await logEvent(db, rule.workspaceId, "keyword_dm_failed", { rule_id: rule.id, reason });
    return status;
  };
  if (now() - c.commentAt > PRIVATE_REPLY_WINDOW_MS) return set("expired", "older_than_7d");

  const key = tokenKey(env);
  const conn = await usableConnection(db, rule);
  if (!conn || !key) {
    await db.update(keywordDmRules).set({ status: "paused", enabled: false, pausedReason: "token_expired", updatedAt: now() }).where(eq(keywordDmRules.id, rule.id));
    await notifyPaused(db, env, rule);
    return set("failed", "token_expired");
  }
  if ((await sentLastHour(db, conn.id)) >= PRIVATE_REPLY_HOURLY_LIMIT) return set("queued", "hourly_limit");

  const link = await ensureCommentDmLink(db, rule);
  if (!link) return set("failed", "no_link");
  const ws = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, rule.workspaceId)).get();
  const token = await decryptToken(key, conn.tokenEnc);
  const text = renderDm(rule.message, `${env.PUBLIC_SHORT_BASE}/${link.slug}`, ws?.name ?? "");
  const r = await sendPrivateReply(env, token, conn.igUserId, c.commentId, text);
  if (!r.ok) {
    if (r.reason === "api_error") return set("queued", `api_error:${r.code ?? ""}`, { linkId: link.id });
    return set("failed", r.message ? `${r.reason}: ${r.message}`.slice(0, 300) : r.reason, { linkId: link.id });
  }
  if (rule.publicReplyVariants.length > 0) {
    const pick = rule.publicReplyVariants[Math.floor(Math.random() * rule.publicReplyVariants.length)];
    if (pick) await sendPublicReply(env, token, c.commentId, pick);
  }
  return set("sent", null, { sentAt: now(), linkId: link.id });
}

// 웹훅 comments 한 건. igAccountId = entry.id (댓글이 달린 브랜드 계정)
export async function handleComment(db: Db, env: Env, igAccountId: string, comment: IgComment, commentAt: number) {
  if (comment.from.id === igAccountId) return; // 브랜드 자신의 댓글(공개 답글 포함)
  const rules = await db
    .select({ rule: keywordDmRules })
    .from(keywordDmRules)
    .innerJoin(igConnections, eq(igConnections.id, keywordDmRules.igConnectionId))
    .where(and(eq(keywordDmRules.igMediaId, comment.media.id), eq(keywordDmRules.status, "on"), eq(igConnections.igUserId, igAccountId)));
  for (const { rule } of rules) {
    if (!matchKeyword(comment.text, rule.keywords)) continue;
    await logEvent(db, rule.workspaceId, "keyword_dm_matched", { rule_id: rule.id });
    const dup = await db.select({ id: keywordDmSends.id }).from(keywordDmSends).where(and(eq(keywordDmSends.ruleId, rule.id), eq(keywordDmSends.igUserId, comment.from.id))).get();
    const id = newId();
    const inserted = await db
      .insert(keywordDmSends)
      .values({ id, ruleId: rule.id, commentId: comment.id, igUserId: comment.from.id, username: comment.from.username ?? null, commentText: comment.text.slice(0, 500), commentAt, status: dup ? "already_sent" : "queued", reason: null })
      .onConflictDoNothing()
      .returning({ id: keywordDmSends.id });
    // 같은 댓글 웹훅 재전송이면 무시, 같은 사람·게시물이면 already_sent 기록만
    if (inserted.length === 0 || dup) continue;
    await deliver(db, env, rule, id, { commentId: comment.id, commentAt });
  }
}

// cron: 대기열(시간 한도·일시 오류) 재시도
export async function retryQueuedDms(env: Env): Promise<void> {
  const db = getDb(env.DB);
  const rows = await db
    .select({ send: keywordDmSends, rule: keywordDmRules })
    .from(keywordDmSends)
    .innerJoin(keywordDmRules, eq(keywordDmRules.id, keywordDmSends.ruleId))
    .where(and(eq(keywordDmSends.status, "queued"), eq(keywordDmRules.status, "on")))
    .orderBy(asc(keywordDmSends.commentAt))
    .limit(100);
  for (const { send, rule } of rows) await deliver(db, env, rule, send.id, { commentId: send.commentId, commentAt: send.commentAt });
}
