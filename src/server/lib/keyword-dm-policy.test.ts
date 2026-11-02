import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { countD1Calls, createSqliteD1 } from "../test/sqlite-d1";
import { getDb } from "../db";
import type { AppEnv, Auth } from "../types";
import { createKeywordDmSender, handleComment, retryQueuedDms, type IgComment } from "./keyword-dm";
import { createKeywordDmRoutes, keywordDmRoutes } from "../routes/keyword-dm";
import { dmPolicyStatus, productionDmPolicy, productionMessagePolicy } from "./message-policy";
import { sendPrivateReply, sendPublicReply } from "./instagram";
import { encryptToken } from "./crypto";
import { ApiError, errorBody } from "./errors";
import { igWebhookRoutes } from "../routes/instagram";
import { hmacHex } from "./crypto";
import { recordDmConsent, type DmRecipientVerifier } from "./dm-consent";

const NOW = Date.parse("2026-11-01T05:00:00Z"), KEY = "local-dm-key";
const closes: (() => void)[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { closes.splice(0).forEach((close) => close()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const comment: IgComment = { id: "private-comment", text: "give PRIVATE-COMMENT", from: { id: "private-recipient", username: "private-name" }, media: { id: "media" } };

async function setup() {
  const base = await createSqliteD1(); closes.push(base.close); const { db } = base;
  db.exec(`INSERT INTO workspaces(id,name,created_at) VALUES('w','test brand',1),('other','other',1);
    INSERT INTO brands(id,workspace_id,name,created_at) VALUES('brand','w','brand',1);
    INSERT INTO campaigns(id,workspace_id,brand_id,name,status,created_at,updated_at) VALUES('campaign','w','brand','campaign','active',1,1);
    INSERT INTO guides(id,workspace_id,campaign_id,name,slug,status,extra_rules,product,deliverables,secondary_use_scope,created_at,updated_at) VALUES('guide','w','campaign','guide','guide-slug','published','[]','{}','{}','{}',1,1);
    INSERT INTO influencers(id,workspace_id,display_name,lang,created_at) VALUES('creator','w','creator','ko',1);
    INSERT INTO short_links(id,workspace_id,guide_id,influencer_id,channel_key,slug,destination_type,destination_url,utm,og,created_at) VALUES('link','w','guide','creator','ig_comment_dm','link-slug','url','https://example.test','{}','{}',1);`);
  db.prepare("INSERT INTO ig_connections(id,workspace_id,target,ig_user_id,account_type,scopes,token_enc,expires_at,connected_at,generation,grants_verified_at,created_at) VALUES('sender','w','brand_sender','123456','BUSINESS',?,?,?,?,'generation',?,1)")
    .run(JSON.stringify(["instagram_business_basic", "instagram_business_manage_insights", "instagram_business_manage_comments", "instagram_business_manage_messages"]), await encryptToken(KEY, "PRIVATE-TOKEN"), NOW + 3_600_000, NOW, NOW);
  db.exec(`INSERT INTO keyword_dm_rules(id,workspace_id,guide_id,influencer_id,ig_connection_id,ig_media_id,keywords,message,public_reply_variants,status,enabled,created_at,updated_at)
    VALUES('rule','w','guide','creator','sender','media','["give"]','PRIVATE-BODY {link}','["PRIVATE-PUBLIC"]','on',1,1,1);`);
  const fetch = vi.fn(() => { throw new Error("unexpected real provider HTTP"); }); vi.stubGlobal("fetch", fetch);
  const env = { DB: base.d1, TOKEN_ENC_KEY: KEY, META_APP_ID: "configured-app", META_APP_SECRET: "configured-secret", RESEND_API_KEY: "configured-mail", EMAIL_FROM: "mail@example.test", APP_ENV: "production", PUBLIC_SHORT_BASE: "https://app.test/l" } as Env;
  const auth: Auth = { sessionId: "session", user: { id: "owner", name: "owner", email: "owner@example.test" }, role: "owner", phone: null, phoneVerified: true, workspace: { id: "w", name: "w", plan: "starter", onboardedAt: 1 } };
  const appFor = (routes = keywordDmRoutes) => {
    const app = new Hono<AppEnv>(); app.use("*", async (c, next) => { c.set("db", getDb(c.env.DB)); c.set("auth", auth); await next(); }); app.route("/keyword-dm", routes);
    app.onError((e, c) => e instanceof ApiError ? c.json(errorBody(e.code, e.message), e.status) : c.text("failed", 500)); return app;
  };
  const sends = () => db.prepare("SELECT status,reason,sent_at,link_id FROM keyword_dm_sends ORDER BY id").all();
  const fake = { privateReply: vi.fn(async () => ({ ok: true as const, data: { message_id: "fake-private" } })), publicReply: vi.fn(async () => ({ ok: true as const, data: { id: "fake-public" } })) };
  const verifyRecipient: DmRecipientVerifier = async (context) => ({ ...context, namespace: "instagram_messaging_igsid", appId: env.META_APP_ID!, recipientId: `mapped-${context.commentActorId}`, mappingDigest: "a".repeat(64) });
  const grant = (actor: string) => recordDmConsent(getDb(base.d1), env, { identity: { workspaceId: "w", connectionId: "sender", connectionGeneration: "generation", senderAccountId: "123456", namespace: "instagram_messaging_igsid", appId: env.META_APP_ID!, recipientId: `mapped-${actor}` },
    source: "verified_recipient_action", proofReference: `test-proof-${actor}`, identityProofDigest: "a".repeat(64), noticeDigest: "b".repeat(64), action: "grant", expectedRevision: 0 });
  return { ...base, orm: getDb(base.d1), env, fetch, auth, appFor, sends, fake, verifyRecipient, grant };
}

describe("independent fail-closed production DM policy", () => {
  it("direct private/public helpers block even configured credentials, fake mode and Env override names", async () => {
    const { env, fetch } = await setup();
    expect(Object.isFrozen(productionDmPolicy)).toBe(true); expect(dmPolicyStatus()).toMatchObject({ configured: false, reason: "send_policy_unconfigured" });
    expect(productionDmPolicy).not.toBe(productionMessagePolicy);
    for (const IG_FAKE of [undefined, "1"]) {
      const input = { ...env, IG_FAKE, ALLOW_DM_SEND: "1", DM_POLICY_CONFIGURED: "true" } as Env;
      expect(await sendPrivateReply(input, "PRIVATE-TOKEN", "123", "comment", "PRIVATE-BODY")).toMatchObject({ ok: false, reason: "send_policy_unconfigured" });
      expect(await sendPublicReply(input, "PRIVATE-TOKEN", "comment", "PRIVATE-PUBLIC")).toMatchObject({ ok: false, reason: "send_policy_unconfigured" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normal webhook matches once, records the policy failure once, and performs no provider HTTP", async () => {
    const { env, db, fetch, sends } = await setup(), pending: Promise<unknown>[] = [];
    const app = new Hono<AppEnv>(); app.use("*", async (c, next) => { c.set("db", getDb(c.env.DB)); await next(); }); app.route("/webhooks", igWebhookRoutes);
    const raw = JSON.stringify({ entry: [{ id: "123456", time: NOW / 1000, changes: [{ field: "comments", value: comment }] }] });
    const headers = { "x-hub-signature-256": `sha256=${await hmacHex(env.META_APP_SECRET!, raw)}` };
    for (let i = 0; i < 2; i++) expect((await app.request("/webhooks/instagram", { method: "POST", headers, body: raw }, env, { waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext)).status).toBe(200);
    await Promise.all(pending);
    expect(sends()).toEqual([{ status: "failed", reason: "send_policy_unconfigured", sent_at: null, link_id: null }]);
    expect(db.prepare("SELECT name FROM events ORDER BY rowid").all()).toEqual([{ name: "keyword_dm_matched" }, { name: "keyword_dm_failed" }]);
    expect(db.prepare("SELECT enabled,status,message FROM keyword_dm_rules").all()).toEqual([{ enabled: 1, status: "on", message: "PRIVATE-BODY {link}" }]);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(db.prepare("SELECT props FROM events").all()) + JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/PRIVATE|private-recipient|private-comment/);
  });

  it("queued retry is terminally blocked without touching connection state or repeating error receipts", async () => {
    const { env, db, sends, fetch } = await setup();
    db.exec("INSERT INTO keyword_dm_sends(id,rule_id,comment_id,ig_user_id,comment_at,status) VALUES('send','rule','old-comment','recipient',1,'queued')");
    const before = db.prepare("SELECT * FROM ig_connections").all();
    await Promise.all([retryQueuedDms(env), retryQueuedDms(env)]); await retryQueuedDms(env);
    expect(sends()).toEqual([{ status: "failed", reason: "send_policy_unconfigured", sent_at: null, link_id: null }]);
    expect(db.prepare("SELECT * FROM ig_connections").all()).toEqual(before); expect(db.prepare("SELECT count(*) AS n FROM events WHERE name='keyword_dm_failed'").all()).toEqual([{ n: 1 }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("enable is a clear 503 and no mutation; off and editing drafts remain available, tenant/role guards remain", async () => {
    const { env, db, appFor, auth, fetch } = await setup(), app = appFor();
    const request = (url: string, body: object, method = "POST") => app.request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);
    const before = db.prepare("SELECT * FROM keyword_dm_rules").all();
    const blocked = await request("/keyword-dm/rule/toggle", { on: true }); expect(blocked.status).toBe(503); expect(await blocked.json()).toMatchObject({ error: { code: "send_policy_unconfigured" } });
    expect(db.prepare("SELECT * FROM keyword_dm_rules").all()).toEqual(before);
    const settings = await (await app.request("/keyword-dm", undefined, env)).json() as { sendPolicy: unknown }; expect(settings.sendPolicy).toEqual(dmPolicyStatus());
    const draft = { guideId: "guide", influencerId: "creator", igMediaId: "media", keywords: ["new"], message: "Draft {link}", publicReplyVariants: [] };
    expect((await request("/keyword-dm", draft)).status).toBe(201);
    expect((await request("/keyword-dm/rule", draft, "PATCH")).status).toBe(200);
    expect((await request("/keyword-dm/rule/toggle", { on: false })).status).toBe(200);
    expect(db.prepare("SELECT status,enabled FROM keyword_dm_rules").all().every((r) => r.status === "off" && r.enabled === 0)).toBe(true);
    auth.role = "viewer"; expect((await request("/keyword-dm/rule/toggle", { on: true })).status).toBe(403); expect((await request("/keyword-dm", draft)).status).toBe(403);
    auth.role = "owner"; auth.workspace!.id = "other"; expect((await request("/keyword-dm/rule/toggle", { on: true })).status).toBe(404); expect((await request("/keyword-dm", draft)).status).toBe(404); expect(fetch).not.toHaveBeenCalled();
  });

  it("trusted fake policy/provider can exercise a send and duplicate webhook without opening the real adapter", async () => {
    const { env, orm, fake, sends, fetch, verifyRecipient, grant, appFor } = await setup(); await grant(comment.from.id);
    const sender = createKeywordDmSender({ configured: true }, fake, verifyRecipient);
    await sender.handleComment(orm, env, "123456", comment, NOW); await sender.handleComment(orm, env, "123456", comment, NOW);
    expect(fake.privateReply).toHaveBeenCalledOnce(); expect(fake.publicReply).toHaveBeenCalledOnce(); expect(sends()[0]).toMatchObject({ status: "sent", reason: null, sent_at: NOW }); expect(fetch).not.toHaveBeenCalled();
    const dto = await (await appFor().request("/keyword-dm/rule/sends",undefined,env)).json() as { sends: Record<string,unknown>[] };
    expect(Object.keys(dto.sends[0]!).sort()).toEqual(["commentAt","commentId","commentText","id","igUserId","linkId","reason","ruleId","sentAt","status","username"]);
    // A test policy alone cannot bypass the independent real-provider guard.
    await grant("recipient2");
    const actual = createKeywordDmSender({ configured: true }, undefined, verifyRecipient);
    await actual.handleComment(orm, env, "123456", { ...comment, id: "comment2", from: { id: "recipient2" } }, NOW);
    expect(sends().some((s) => s.reason?.toString().startsWith("send_policy_unconfigured"))).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });

  it("policy is checked immediately before private send and again before public followup", async () => {
    const first = await setup(); await first.grant(comment.from.id); let checks = 0;
    const sender = createKeywordDmSender({ get configured() { return ++checks === 1; } }, first.fake, first.verifyRecipient);
    await sender.handleComment(first.orm, first.env, "123456", comment, NOW); expect(first.fake.privateReply).not.toHaveBeenCalled();
    const second = await setup(), policy = { configured: true }; await second.grant(comment.from.id);
    second.fake.privateReply.mockImplementation(async () => { policy.configured = false; return { ok: true, data: { message_id: "fake" } }; });
    await createKeywordDmSender(policy, second.fake, second.verifyRecipient).handleComment(second.orm, second.env, "123456", comment, NOW);
    expect(second.fake.privateReply).toHaveBeenCalledOnce(); expect(second.fake.publicReply).not.toHaveBeenCalled(); expect(second.sends()[0]?.status).toBe("sent");
  });

  it("DB error retains pending work, reports a sanitized error and cannot make HTTP; recovery records one failure", async () => {
    const { env, db, orm, sends, fetch } = await setup();
    db.exec("CREATE TRIGGER fail_dm BEFORE UPDATE ON keyword_dm_sends BEGIN SELECT RAISE(ABORT,'PRIVATE-COMMENT PRIVATE-TOKEN'); END");
    await expect(handleComment(orm, env, "123456", comment, NOW)).rejects.toThrow(/^keyword_dm_processing_failed$/);
    expect(sends()[0]?.status).toBe("queued"); expect(fetch).not.toHaveBeenCalled();
    db.exec("DROP TRIGGER fail_dm"); await retryQueuedDms(env); expect(sends()[0]?.reason).toBe("send_policy_unconfigured");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/PRIVATE|private-recipient/);
  });

  it("a policy audit SQL failure rolls the status change back so later cron can record exactly one failure", async () => {
    const { env, db, orm, sends, fetch } = await setup();
    db.exec("CREATE TRIGGER fail_policy_audit BEFORE INSERT ON events WHEN NEW.name='keyword_dm_failed' BEGIN SELECT RAISE(ABORT,'PRIVATE-COMMENT'); END");
    await expect(handleComment(orm, env, "123456", comment, NOW)).rejects.toThrow(/^keyword_dm_processing_failed$/);
    expect(sends()[0]?.status).toBe("queued"); expect(db.prepare("SELECT count(*) AS n FROM events WHERE name='keyword_dm_failed'").all()).toEqual([{ n: 0 }]);
    db.exec("DROP TRIGGER fail_policy_audit"); await retryQueuedDms(env); await retryQueuedDms(env);
    expect(sends()[0]?.reason).toBe("send_policy_unconfigured"); expect(db.prepare("SELECT count(*) AS n FROM events WHERE name='keyword_dm_failed'").all()).toEqual([{ n: 1 }]); expect(fetch).not.toHaveBeenCalled();
  });

  it("a full 100-row cron batch uses two D1 API calls and terminal failures do not enqueue or repeat", async () => {
    const { env, db, fetch, d1 } = await setup(); const meter = countD1Calls(d1); let physical = 0, maxBinds = 0, maxBytes = 0;
    const wrap = (s: D1PreparedStatement): D1PreparedStatement => new Proxy(s, { get(target, key) {
      if (key === "bind") return (...params: unknown[]) => { maxBinds = Math.max(maxBinds, params.length); maxBytes = Math.max(maxBytes, new TextEncoder().encode(JSON.stringify(params)).byteLength); return wrap(target.bind(...params)); };
      if (["first", "all", "run", "raw"].includes(String(key))) return (...args: unknown[]) => { physical++; return Reflect.get(target, key).apply(target, args); };
      return Reflect.get(target, key);
    } });
    env.DB = { ...meter.d1, prepare: (sql: string) => wrap(meter.d1.prepare(sql)), batch: (statements: D1PreparedStatement[]) => { physical += statements.length; return meter.d1.batch(statements); } } as D1Database;
    const insert = db.prepare("INSERT INTO keyword_dm_sends(id,rule_id,comment_id,ig_user_id,comment_at,status) VALUES(?,'rule',?,'recipient',1,'queued')");
    for (let i = 0; i < 100; i++) insert.run(`send-${i}`, `comment-${i}`);
    await retryQueuedDms(env); expect(meter.getCalls()).toBe(2);
    expect(physical).toBe(3); expect(maxBinds).toBeLessThanOrEqual(100); expect(maxBytes).toBeLessThan(64 * 1024);
    expect(db.prepare("SELECT count(*) AS n FROM keyword_dm_sends WHERE status='failed' AND reason='send_policy_unconfigured'").all()).toEqual([{ n: 100 }]);
    await retryQueuedDms(env); expect(db.prepare("SELECT count(*) AS n FROM events WHERE name='keyword_dm_failed'").all()).toEqual([{ n: 100 }]); expect(fetch).not.toHaveBeenCalled();
  });

  it("a policy-blocked comment is never reported as an already sent DM for the next comment", async () => {
    const { env, orm, sends, fake, grant, verifyRecipient } = await setup();
    await handleComment(orm, env, "123456", comment, NOW);
    await handleComment(orm, env, "123456", { ...comment, id: "another-comment" }, NOW);
    expect(sends().every((s) => s.status === "failed" && s.reason === "send_policy_unconfigured")).toBe(true);
    await grant(comment.from.id);
    await createKeywordDmSender({ configured: true }, fake, verifyRecipient).handleComment(orm, env, "123456", { ...comment, id: "fake-approved-later-comment" }, NOW);
    expect(fake.privateReply).toHaveBeenCalledOnce();
  });

  it("a lost successful policy batch response leaves one terminal status and one audit, with no provider retry", async () => {
    const { env, db, orm, d1, sends, fetch } = await setup(); let lose = true;
    const uncertain = { ...d1, batch: async (statements: D1PreparedStatement[]) => { const result = await d1.batch(statements); if (lose) { lose = false; throw new Error("PRIVATE lost response"); } return result; } } as D1Database;
    await expect(handleComment(getDb(uncertain), env, "123456", comment, NOW)).rejects.toThrow(/^keyword_dm_processing_failed$/);
    expect(sends()[0]).toMatchObject({ status: "failed", reason: "send_policy_unconfigured" });
    await handleComment(orm, env, "123456", comment, NOW); await retryQueuedDms(env);
    expect(db.prepare("SELECT count(*) AS n FROM events WHERE name='keyword_dm_failed'").all()).toEqual([{ n: 1 }]); expect(fetch).not.toHaveBeenCalled();
  });
});
