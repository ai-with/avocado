import { sql, type SQLWrapper } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { Db } from "../db";
import type { keywordDmRules, keywordDmSends } from "../db/schema";
import { hmacHex } from "./crypto";
import { newId, newToken, now } from "./ids";
import { igConnectionUsableSql } from "./ig-connection-state";

type Rule = typeof keywordDmRules.$inferSelect;
type Send = typeof keywordDmSends.$inferSelect;
export type DmRecipientContext = { workspaceId: string; connectionId: string; connectionGeneration: string; senderAccountId: string; commentId: string; commentActorId: string };
export type VerifiedDmRecipient = DmRecipientContext & { namespace: "instagram_messaging_igsid"; appId: string; recipientId: string; mappingDigest: string };
export type DmRecipientVerifier = (context: DmRecipientContext) => Promise<VerifiedDmRecipient | null>;
// No verified comment-author -> messaging-IGSID bridge exists in production.
// A username, matching strings, OAuth subject or comment is never such proof.
export const unverifiedDmRecipient: DmRecipientVerifier = async () => null;
type Identity = Pick<VerifiedDmRecipient, "workspaceId" | "connectionId" | "connectionGeneration" | "senderAccountId" | "namespace" | "appId" | "recipientId">;
type Scope = { workspaceId: string; connectionId: string; connectionGeneration: string; senderAccountId: string; appHmac: string; recipientHmac: string };
export type DmBinding = { dmConsentId: string | null; dmConsentRevision: number | null; dmAppHmac: string; dmRecipientHmac: string; dmSenderGeneration: string };
export const DM_ATTEMPT_RECOVERY_MS = 60_000; // Provider timeout is 20s; never retry an uncertain private reply.
const HASH = /^[a-f0-9]{64}$/;
const fail = () => new Error("dm_consent_conflict");
const dialect = new SQLiteSyncDialect();
function batch(db: Db, statements: SQLWrapper[]) {
  return db.$client.batch(statements.map((statement) => { const q = dialect.sqlToQuery(statement.getSQL()); return db.$client.prepare(q.sql).bind(...q.params); }));
}
async function scopeFor(env: Env, identity: Identity): Promise<Scope> {
  if (!env.TOKEN_ENC_KEY || !env.META_APP_ID || identity.appId !== env.META_APP_ID || identity.namespace !== "instagram_messaging_igsid"
    || [identity.workspaceId, identity.connectionId, identity.connectionGeneration, identity.senderAccountId, identity.recipientId].some((v) => typeof v !== "string" || !/^[\w-]{1,200}$/.test(v))) throw fail();
  const appHmac = await hmacHex(env.TOKEN_ENC_KEY, JSON.stringify(["dm-app-v1", identity.appId]));
  const recipientHmac = await hmacHex(env.TOKEN_ENC_KEY, JSON.stringify(["dm-recipient-v1", identity.appId, identity.namespace, identity.senderAccountId, identity.recipientId]));
  return { workspaceId: identity.workspaceId, connectionId: identity.connectionId, connectionGeneration: identity.connectionGeneration, senderAccountId: identity.senderAccountId, appHmac, recipientHmac };
}
const scopeSql = (scope: Scope) => sql`workspace_id=${scope.workspaceId} AND connection_id=${scope.connectionId} AND connection_generation=${scope.connectionGeneration} AND app_hmac=${scope.appHmac} AND recipient_hmac=${scope.recipientHmac}`;
const senderSql = (scope: Scope) => sql`EXISTS(SELECT 1 FROM ig_connections c WHERE c.id=${scope.connectionId} AND c.workspace_id=${scope.workspaceId} AND c.target='brand_sender'
  AND c.generation=${scope.connectionGeneration} AND c.ig_user_id=${scope.senderAccountId} AND ${igConnectionUsableSql("c")})`;

// Trusted internal storage boundary only. No route, comment handler or OAuth
// callback produces this proof. A future reviewed capture must verify identity,
// the explicit recipient action, current notice and provider-event ownership.
export async function recordDmConsent(db: Db, env: Env, input: { identity: Identity; source: "verified_recipient_action"; proofReference: string; identityProofDigest: string; noticeDigest: string; action: "grant" | "revoke"; expectedRevision: number }) {
  try {
    const scope = await scopeFor(env, input.identity), key = env.TOKEN_ENC_KEY!;
    if (input.source !== "verified_recipient_action" || !HASH.test(input.identityProofDigest) || !HASH.test(input.noticeDigest) || !["grant", "revoke"].includes(input.action)
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= Number.MAX_SAFE_INTEGER || !input.proofReference || input.proofReference.length > 200) throw fail();
    const proof = await hmacHex(key, JSON.stringify(["dm-proof-v1", input.identity.appId, input.proofReference]));
    const fingerprint = await hmacHex(key, JSON.stringify([scope, input.identityProofDigest, input.noticeDigest, input.action, input.expectedRevision]));
    const receipt = () => db.get<{ fingerprint: string; revision: number }>(sql`SELECT fingerprint,revision FROM dm_consent_receipts WHERE proof_hmac=${proof}`);
    const old = await receipt(); if (old) { if (old.fingerprint !== fingerprint) throw fail(); return { revision: old.revision, replayed: true }; }
    const at = now(), next = input.expectedRevision + 1;
    try { await batch(db, [
      sql`SELECT CASE WHEN ${senderSql(scope)} AND coalesce((SELECT revision FROM dm_channel_consents WHERE ${scopeSql(scope)}),0)=${input.expectedRevision}
        AND NOT EXISTS(SELECT 1 FROM dm_consent_receipts WHERE proof_hmac=${proof}) THEN 1 ELSE json('dm_consent_conflict') END`,
      sql`INSERT INTO dm_channel_consents(id,workspace_id,connection_id,connection_generation,app_hmac,recipient_hmac,recipient_namespace,revision,status,notice_digest,proof_hmac,granted_at,revoked_at,created_at,updated_at)
        VALUES(${newId()},${scope.workspaceId},${scope.connectionId},${scope.connectionGeneration},${scope.appHmac},${scope.recipientHmac},'instagram_messaging_igsid',${next},${input.action === "grant" ? "granted" : "revoked"},${input.noticeDigest},${proof},${input.action === "grant" ? at : null},${input.action === "revoke" ? at : null},${at},${at})
        ON CONFLICT(workspace_id,connection_id,connection_generation,app_hmac,recipient_hmac) DO UPDATE SET revision=excluded.revision,status=excluded.status,notice_digest=excluded.notice_digest,proof_hmac=excluded.proof_hmac,
        granted_at=CASE WHEN excluded.status='granted' THEN excluded.granted_at ELSE granted_at END,revoked_at=excluded.revoked_at,updated_at=excluded.updated_at WHERE revision=${input.expectedRevision}`,
      sql`INSERT INTO dm_consent_receipts(proof_hmac,consent_id,fingerprint,revision,action,created_at)
        SELECT ${proof},id,${fingerprint},${next},${input.action},${at} FROM dm_channel_consents WHERE ${scopeSql(scope)} AND revision=${next}`,
    ]); } catch { const found = await receipt(); if (found?.fingerprint !== fingerprint) throw fail(); return { revision: found.revision, replayed: true }; }
    return { revision: next, replayed: false };
  } catch { throw fail(); }
}

export async function resolveDmConsent(db: Db, env: Env, context: DmRecipientContext, verify: DmRecipientVerifier): Promise<{ scope: Scope; binding: DmBinding } | null> {
  const identity = await verify(context);
  if (!identity || !HASH.test(identity.mappingDigest) || Object.keys(context).some((key) => context[key as keyof DmRecipientContext] !== identity[key as keyof DmRecipientContext])) return null;
  let scope: Scope; try { scope = await scopeFor(env, identity); } catch { return null; }
  const row = await db.get<{ id: string; revision: number }>(sql`SELECT id,revision FROM dm_channel_consents WHERE ${scopeSql(scope)}`);
  return { scope, binding: { dmConsentId: row?.id ?? null, dmConsentRevision: row?.revision ?? null, dmAppHmac: scope.appHmac, dmRecipientHmac: scope.recipientHmac, dmSenderGeneration: scope.connectionGeneration } };
}
function sendScopeMatches(send: Send, scope: Scope) {
  return send.dmAppHmac === scope.appHmac && send.dmRecipientHmac === scope.recipientHmac && send.dmSenderGeneration === scope.connectionGeneration;
}
export async function dmConsentReason(db: Db, send: Send, scope: Scope): Promise<string | null> {
  if (!sendScopeMatches(send, scope)) return "dm_identity_unverified";
  if (!send.dmConsentId || send.dmConsentRevision === null) return "dm_consent_missing";
  const current = await db.get<{ revision: number; status: string }>(sql`SELECT revision,status FROM dm_channel_consents WHERE id=${send.dmConsentId} AND ${scopeSql(scope)}`);
  if (!current) return "dm_consent_missing";
  if (current.status !== "granted") return "dm_consent_revoked";
  return current.revision === send.dmConsentRevision ? null : "dm_consent_stale";
}
export async function storedDmConsentReason(db: Db, rule: Rule, send: Send) {
  if (!rule.igConnectionId || !send.dmAppHmac || !send.dmRecipientHmac || !send.dmSenderGeneration) return "dm_identity_unverified";
  // This is only an early denial check. It grants no identity or send authority.
  return dmConsentReason(db, send, { workspaceId: rule.workspaceId, connectionId: rule.igConnectionId, connectionGeneration: send.dmSenderGeneration,
    appHmac: send.dmAppHmac, recipientHmac: send.dmRecipientHmac, senderAccountId: "" });
}
export function dmRuleHmac(env: Env, rule: Rule) {
  if (!env.TOKEN_ENC_KEY) throw fail();
  return hmacHex(env.TOKEN_ENC_KEY, JSON.stringify(["dm-rule-v1",rule.id,rule.workspaceId,rule.igConnectionId,rule.igMediaId,rule.guideId,rule.influencerId,
    rule.keywords,rule.message,rule.publicReplyVariants,rule.status,rule.enabled,rule.updatedAt,rule.dmRevision]));
}
const authority = (scope: Scope, rule: Rule, send: Send) => sql`${senderSql(scope)} AND EXISTS(SELECT 1 FROM keyword_dm_rules r WHERE r.id=${rule.id} AND r.workspace_id=${scope.workspaceId}
  AND r.ig_connection_id=${scope.connectionId} AND r.ig_media_id=${rule.igMediaId} AND r.status='on' AND r.enabled=1 AND r.updated_at=${rule.updatedAt} AND r.dm_revision=${rule.dmRevision}
  AND r.guide_id IS ${rule.guideId} AND r.influencer_id IS ${rule.influencerId} AND r.message=${rule.message}
  AND json(r.keywords)=json(${JSON.stringify(rule.keywords)}) AND json(r.public_reply_variants)=json(${JSON.stringify(rule.publicReplyVariants)}))
  AND EXISTS(SELECT 1 FROM dm_channel_consents WHERE id=${send.dmConsentId} AND ${scopeSql(scope)} AND status='granted' AND revision=${send.dmConsentRevision})`;
export async function claimDmAttempt(db: Db, rule: Rule, send: Send, scope: Scope) {
  const reason = await dmConsentReason(db, send, scope); if (reason) return { ok: false as const, reason };
  const token = newToken(18), rows = await db.all<{ id: string }>(sql`UPDATE keyword_dm_sends SET status='sending',dm_attempt_token=${token},dm_attempt_at=${now()}
    WHERE id=${send.id} AND rule_id=${rule.id} AND comment_id=${send.commentId} AND ig_user_id=${send.igUserId} AND status='queued'
    AND dm_consent_id=${send.dmConsentId} AND dm_consent_revision=${send.dmConsentRevision} AND dm_app_hmac=${scope.appHmac} AND dm_recipient_hmac=${scope.recipientHmac}
    AND dm_sender_generation=${scope.connectionGeneration} AND dm_rule_hmac=${send.dmRuleHmac} AND ${authority(scope, rule, send)} RETURNING id`);
  if (rows.length) return { ok: true as const, token };
  const active = await db.get(sql`SELECT 1 FROM keyword_dm_sends WHERE id=${send.id} AND status IN('sending','sent','unknown')`);
  return { ok: false as const, reason: active ? "dm_already_attempted" : await dmConsentReason(db, send, scope) ?? "dm_authority_changed" };
}
export async function dmAttemptCurrent(db: Db, rule: Rule, send: Send, scope: Scope, token: string) {
  return Boolean(await db.get(sql`SELECT 1 FROM keyword_dm_sends WHERE id=${send.id} AND rule_id=${rule.id} AND status IN('sending','sent') AND dm_attempt_token=${token}
    AND dm_consent_id=${send.dmConsentId} AND dm_consent_revision=${send.dmConsentRevision} AND dm_rule_hmac=${send.dmRuleHmac} AND ${authority(scope, rule, send)}`));
}
