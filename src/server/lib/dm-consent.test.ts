import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db";
import { createSqliteD1 } from "../test/sqlite-d1";
import { encryptToken } from "./crypto";
import { recordDmConsent, type DmRecipientVerifier } from "./dm-consent";
import { createKeywordDmSender, type IgComment } from "./keyword-dm";
import { sendPrivateReply, sendPublicReply } from "./instagram";

const NOW = 1_800_000_000_000, KEY = "local-consent-key", SECRET = "PRIVATE-RECIPIENT", closes: (() => void)[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {}); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("real HTTP forbidden"); })); });
afterEach(() => { closes.splice(0).forEach((close) => close()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const comment = (id = "comment", actor = "comment-author"): IgComment => ({ id, from: { id: actor, username: "PRIVATE-NAME" }, text: "give PRIVATE-COMMENT", media: { id: "media" } });
function interceptD1(d1: D1Database, hook: (text: string, phase: "before" | "after") => Promise<void>) {
  const wrap = (statement: D1PreparedStatement, text: string): D1PreparedStatement => new Proxy(statement, { get(target,key) {
    if (key === "bind") return (...args: unknown[]) => wrap(target.bind(...args),text);
    if (["first","all","run","raw"].includes(String(key))) return async (...args: unknown[]) => { await hook(text,"before"); const result = await Reflect.get(target,key).apply(target,args); await hook(text,"after"); return result; };
    return Reflect.get(target,key);
  } });
  return { ...d1, prepare: (text: string) => wrap(d1.prepare(text),text) } as D1Database;
}
async function setup() {
  const s = await createSqliteD1(); closes.push(s.close); const db = s.db;
  db.exec(`INSERT INTO workspaces(id,name,created_at) VALUES('w','Synthetic',1),('other','Other',1);
    INSERT INTO guides(id,workspace_id,name,slug,status,extra_rules,product,deliverables,secondary_use_scope,created_at,updated_at) VALUES('g','w','Guide','guide','published','[]','{}','{}','{}',1,1);
    INSERT INTO influencers(id,workspace_id,display_name,created_at) VALUES('creator','w','Synthetic',1);
    INSERT INTO short_links(id,workspace_id,guide_id,influencer_id,channel_key,slug,destination_type,destination_url,utm,og,created_at) VALUES('link','w','g','creator','ig_comment_dm','slug','url','https://example.invalid','{}','{}',1);
    INSERT INTO leads(id,workspace_id,email,phone,answers,marketing_opt_in,alimtalk_opt_in,unsubscribe_token,first_source,last_source,created_at) VALUES('lead','w','synthetic@example.invalid','01000000000','{}',1,1,'unsubscribe','{}','{}',1);`);
  db.prepare("INSERT INTO ig_connections(id,workspace_id,target,ig_user_id,account_type,scopes,token_enc,expires_at,connected_at,generation,grants_verified_at,created_at) VALUES('sender','w','brand_sender','brand','BUSINESS',?,?,?,?,'generation',?,1)")
    .run(JSON.stringify(["instagram_business_basic","instagram_business_manage_insights","instagram_business_manage_comments","instagram_business_manage_messages"]), await encryptToken(KEY,"PRIVATE-TOKEN"), NOW+3_600_000,NOW,NOW);
  db.exec("INSERT INTO keyword_dm_rules(id,workspace_id,guide_id,influencer_id,ig_connection_id,ig_media_id,keywords,message,public_reply_variants,status,enabled,created_at,updated_at) VALUES('rule','w','g','creator','sender','media','[\"give\"]','PRIVATE-BODY {link}','[\"PRIVATE-PUBLIC\"]','on',1,1,1)");
  const env = { DB: s.d1, TOKEN_ENC_KEY: KEY, META_APP_ID: "app", META_APP_SECRET: "secret", APP_ENV: "production", PUBLIC_SHORT_BASE: "https://app.invalid/l" } as Env;
  const orm = getDb(s.d1);
  const identity = { workspaceId: "w", connectionId: "sender", connectionGeneration: "generation", senderAccountId: "brand", namespace: "instagram_messaging_igsid" as const, appId: "app", recipientId: SECRET };
  let serial = 0;
  const decision = (action: "grant" | "revoke", expectedRevision: number, proofReference = `fixture-proof-${++serial}`, overrides: Partial<typeof identity> = {}) => recordDmConsent(orm, env, { identity: { ...identity, ...overrides }, source: "verified_recipient_action", proofReference, identityProofDigest: "a".repeat(64), noticeDigest: "b".repeat(64), action, expectedRevision });
  const verify: DmRecipientVerifier = vi.fn(async (ctx) => ({ ...ctx, namespace: "instagram_messaging_igsid", appId: "app", recipientId: SECRET, mappingDigest: "a".repeat(64) }));
  const provider = { privateReply: vi.fn(async (..._args: Parameters<typeof sendPrivateReply>): ReturnType<typeof sendPrivateReply> => ({ ok: true, data: { message_id: "fake-private" } })),
    publicReply: vi.fn(async (..._args: Parameters<typeof sendPublicReply>): ReturnType<typeof sendPublicReply> => ({ ok: true, data: { id: "fake-public" } })) };
  const sender = createKeywordDmSender({ configured: true }, provider, verify);
  const send = (id = "comment") => sender.handleComment(orm, env, "brand", comment(id), NOW);
  const sends = () => db.prepare("SELECT * FROM keyword_dm_sends ORDER BY rowid").all();
  const consent = () => db.prepare("SELECT * FROM dm_channel_consents").all()[0]!;
  return { ...s, orm, env, identity, decision, verify, provider, sender, send, sends, consent };
}
async function queueAtLimit(s: Awaited<ReturnType<typeof setup>>) {
  s.db.exec(`WITH RECURSIVE n(i) AS(SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<749)
    INSERT INTO keyword_dm_sends(id,rule_id,comment_id,ig_user_id,comment_at,sent_at,status) SELECT 'history-'||i,'rule','history-'||i,'history-user',1,${NOW},'sent' FROM n`);
  await s.send(); s.db.exec("DELETE FROM keyword_dm_sends WHERE id LIKE 'history-%'");
}

describe("DM-only consent storage and actual keyword delivery guards", () => {
  it("stores only scoped hashes and explicit proof receipts without changing email/alimtalk flags", async () => {
    const s = await setup(), before = s.db.prepare("SELECT * FROM leads").all();
    await s.decision("grant",0); await s.decision("revoke",1);
    expect(s.consent()).toMatchObject({ revision: 2, status: "revoked", recipient_namespace: "instagram_messaging_igsid" });
    expect(s.db.prepare("SELECT * FROM leads").all()).toEqual(before);
    const encoded = JSON.stringify(s.db.prepare("SELECT * FROM dm_channel_consents").all()) + JSON.stringify(s.db.prepare("SELECT * FROM dm_consent_receipts").all());
    expect(encoded).not.toMatch(/PRIVATE|comment-author|PRIVATE-NAME|PRIVATE-TOKEN/); expect(s.consent().recipient_hmac).toMatch(/^[a-f0-9]{64}$/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("deduplicates proofs, rejects changed/stale grants, and cannot replay a grant over revocation", async () => {
    const s = await setup(); expect(await s.decision("grant",0,"one")).toEqual({ revision: 1, replayed: false });
    expect(await s.decision("grant",0,"one")).toEqual({ revision: 1, replayed: true });
    await s.decision("revoke",1,"two"); await s.decision("grant",0,"one"); expect(s.consent().status).toBe("revoked");
    await expect(s.decision("revoke",0,"one")).rejects.toThrow(/^dm_consent_conflict$/);
    await expect(s.decision("grant",0,"late")).rejects.toThrow(/^dm_consent_conflict$/);
    await s.decision("grant",2,"fresh"); expect(s.consent()).toMatchObject({ status: "granted", revision: 3 });
  });
  it("rejects tenant/generation/app/namespace changes and never uses IG_FAKE to grant without a key", async () => {
    const s = await setup();
    for (const overrides of [{ workspaceId: "other" }, { connectionGeneration: "old" }, { appId: "other-app" }, { namespace: "comment-author" }]) {
      await expect(s.decision("grant",0,undefined,overrides as Partial<typeof s.identity>)).rejects.toThrow(/^dm_consent_conflict$/);
    }
    delete s.env.TOKEN_ENC_KEY; s.env.IG_FAKE = "1"; await expect(s.decision("grant",0)).rejects.toThrow(/^dm_consent_conflict$/);
    expect(s.db.prepare("SELECT * FROM dm_channel_consents").all()).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
  it("missing consent or a missing verified identity bridge blocks the actual send path before providers", async () => {
    const missing = await setup(); await missing.send(); expect(missing.sends()[0]?.reason).toBe("dm_consent_missing");
    expect(missing.provider.privateReply).not.toHaveBeenCalled(); expect(missing.provider.publicReply).not.toHaveBeenCalled();
    const noBridge = await setup(); await noBridge.decision("grant",0);
    await createKeywordDmSender({ configured: true },noBridge.provider).handleComment(noBridge.orm,noBridge.env,"brand",comment(),NOW);
    expect(noBridge.sends()[0]?.reason).toBe("dm_identity_unverified"); expect(noBridge.provider.privateReply).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("revoked consent blocks actual delivery, while a verified explicit grant permits only fake providers", async () => {
    const s = await setup(); await s.decision("grant",0); await s.decision("revoke",1); await s.send();
    expect(s.sends()[0]?.reason).toBe("dm_consent_revoked"); expect(s.provider.privateReply).not.toHaveBeenCalled();
    await s.decision("grant",2); await s.send("new-comment");
    expect(s.provider.privateReply).toHaveBeenCalledOnce(); expect(s.provider.publicReply).toHaveBeenCalledOnce(); expect(s.sends().at(-1)?.status).toBe("sent"); expect(fetch).not.toHaveBeenCalled();
  });
  it("a consent revision captured by queued work cannot revive after revoke/regrant or a stale producer", async () => {
    const s = await setup(); await s.decision("grant",0);
    await queueAtLimit(s); expect(s.sends().at(-1)).toMatchObject({ status: "queued", reason: "hourly_limit", dm_consent_revision: 1 });
    await s.decision("revoke",1); expect(s.sends()[0]?.reason).toBe("dm_consent_changed"); await s.decision("grant",2);
    await s.sender.retryQueuedDms(s.env); expect(s.provider.privateReply).not.toHaveBeenCalled();
    // A stale writer after regrant is also denied by the real consumer.
    s.db.exec("UPDATE keyword_dm_sends SET status='queued',reason=NULL"); await s.sender.retryQueuedDms(s.env);
    expect(s.sends()[0]?.reason).toBe("dm_consent_stale"); expect(s.provider.privateReply).not.toHaveBeenCalled();
    await s.send("fresh-comment"); expect(s.provider.privateReply).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["app","key","connection","rule","tenant"])("a %s change after identity resolution cannot pass the final send claim", async (change) => {
    const s = await setup(); await s.decision("grant",0); let calls = 0;
    const verify: DmRecipientVerifier = async (context) => {
      const identity = await s.verify(context);
      if (++calls === 2) {
        if (change === "app") s.env.META_APP_ID = "changed-app";
        if (change === "key") s.env.TOKEN_ENC_KEY = "changed-key";
        if (change === "connection") s.db.exec("UPDATE ig_connections SET generation='changed-generation'");
        if (change === "rule") s.db.exec("UPDATE keyword_dm_rules SET updated_at=2");
        if (change === "tenant") s.db.exec("UPDATE keyword_dm_rules SET workspace_id='other'");
      }
      return identity;
    };
    await createKeywordDmSender({ configured: true },s.provider,verify).handleComment(s.orm,s.env,"brand",comment(),NOW);
    expect(s.provider.privateReply).not.toHaveBeenCalled(); expect(s.provider.publicReply).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("the native claim itself rejects revocation after its preliminary read", async () => {
    const s = await setup(); await s.decision("grant",0); let once = true;
    const d1 = interceptD1(s.d1,async (text,phase) => { if (once && phase === "before" && text.includes("UPDATE keyword_dm_sends SET status='sending'")) { once = false; await s.decision("revoke",1); } });
    await s.sender.handleComment(getDb(d1),{ ...s.env, DB: d1 },"brand",comment(),NOW);
    expect(once).toBe(false); expect(s.provider.privateReply).not.toHaveBeenCalled(); expect(s.provider.publicReply).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("queued work cannot adopt an edited rule body even when its millisecond timestamp is unchanged", async () => {
    const s = await setup(); await s.decision("grant",0); await queueAtLimit(s);
    s.db.exec("UPDATE keyword_dm_rules SET message='changed PRIVATE-BODY'"); await s.sender.retryQueuedDms(s.env);
    expect(s.sends()[0]?.reason).toBe("dm_authority_changed"); expect(s.provider.privateReply).not.toHaveBeenCalled();
    await s.send("fresh-comment"); expect(s.provider.privateReply).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it("off/on within one millisecond cannot revive a queued rule generation", async () => {
    const s = await setup(); await s.decision("grant",0); await queueAtLimit(s);
    s.db.exec("UPDATE keyword_dm_rules SET status='off',enabled=0; UPDATE keyword_dm_rules SET status='on',enabled=1");
    expect(s.db.prepare("SELECT dm_revision FROM keyword_dm_rules").all()[0]?.dm_revision).toBe(2);
    await s.sender.retryQueuedDms(s.env); await s.send(); expect(s.provider.privateReply).not.toHaveBeenCalled();
    await s.send("fresh-comment"); expect(s.provider.privateReply).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it("revocation inside the last identity await cancels old queued work without an HTTP", async () => {
    const s = await setup(); await s.decision("grant",0); let calls = 0;
    const verify: DmRecipientVerifier = async (context) => { const identity = await s.verify(context); if (++calls === 2) await s.decision("revoke",1); return identity; };
    await createKeywordDmSender({ configured: true },s.provider,verify).handleComment(s.orm,s.env,"brand",comment(),NOW);
    expect(s.provider.privateReply).not.toHaveBeenCalled(); expect(s.provider.publicReply).not.toHaveBeenCalled(); expect(s.sends()[0]?.status).toBe("failed"); expect(fetch).not.toHaveBeenCalled();
  });
  it("a private acceptance already in flight remains factual while revocation blocks the public followup", async () => {
    const s = await setup(); await s.decision("grant",0);
    s.provider.privateReply.mockImplementationOnce(async () => { await s.decision("revoke",1); return { ok: true, data: { message_id: "fake" } }; });
    await s.send(); expect(s.provider.privateReply).toHaveBeenCalledOnce(); expect(s.provider.publicReply).not.toHaveBeenCalled();
    expect(s.sends()[0]).toMatchObject({ status: "sent", sent_at: NOW }); expect(s.consent().status).toBe("revoked"); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["lookup","provider"])("confirmed private acceptance survives a public %s exception", async (phase) => {
    const s = await setup(); await s.decision("grant",0);
    if (phase === "provider") s.provider.publicReply.mockImplementationOnce(async () => { throw new Error("PRIVATE provider failure"); });
    const d1 = interceptD1(s.d1,async (text,when) => { if (phase === "lookup" && when === "before" && text.includes("status IN('sending','sent')")) throw new Error("PRIVATE lookup failure"); });
    await s.sender.handleComment(getDb(d1),{ ...s.env, DB: d1 },"brand",comment(),NOW);
    expect(s.provider.privateReply).toHaveBeenCalledOnce(); expect(s.sends()[0]).toMatchObject({ status: "sent", sent_at: NOW });
    if (phase === "lookup") expect(s.provider.publicReply).not.toHaveBeenCalled();
    await s.sender.retryQueuedDms(s.env); expect(s.provider.privateReply).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("PRIVATE"); expect(fetch).not.toHaveBeenCalled();
  });
  it("concurrent queued workers claim exactly one private/public attempt", async () => {
    const s = await setup(); await s.decision("grant",0); await queueAtLimit(s);
    await Promise.all([s.sender.retryQueuedDms(s.env),s.sender.retryQueuedDms(s.env)]);
    expect(s.provider.privateReply).toHaveBeenCalledOnce(); expect(s.provider.publicReply).toHaveBeenCalledOnce(); expect(s.sends()[0]?.status).toBe("sent"); expect(fetch).not.toHaveBeenCalled();
  });
  it("uncertain provider results are never resent and provider error text is not retained", async () => {
    const s = await setup(); await s.decision("grant",0);
    s.provider.privateReply.mockResolvedValueOnce({ ok: false, reason: "api_error", message: "PRIVATE provider error" });
    await s.send(); expect(s.sends()[0]).toMatchObject({ status: "unknown", reason: "delivery_outcome_unknown" });
    await Promise.all([s.sender.retryQueuedDms(s.env),s.sender.retryQueuedDms(s.env)]);
    expect(s.provider.privateReply).toHaveBeenCalledOnce(); expect(s.provider.publicReply).not.toHaveBeenCalled();
    expect(JSON.stringify(s.db.prepare("SELECT props FROM events").all()) + JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/PRIVATE|comment-author/); expect(fetch).not.toHaveBeenCalled();
  });
  it("lost claim ACK preserves one durable attempt and maintenance records unknown without resending", async () => {
    const s = await setup(); await s.decision("grant",0); let once = true;
    const d1 = interceptD1(s.d1,async (text,phase) => { if (once && phase === "after" && text.includes("UPDATE keyword_dm_sends SET status='sending'")) { once = false; throw new Error("PRIVATE ACK lost"); } });
    await expect(s.sender.handleComment(getDb(d1),{ ...s.env, DB: d1 },"brand",comment(),NOW)).rejects.toThrow(/^keyword_dm_processing_failed$/);
    expect(s.sends()[0]?.status).toBe("sending"); expect(s.provider.privateReply).not.toHaveBeenCalled();
    s.db.exec("UPDATE keyword_dm_rules SET status='off',enabled=0");
    vi.mocked(Date.now).mockReturnValue(NOW+60_001); await s.sender.retryQueuedDms(s.env); await s.sender.retryQueuedDms(s.env);
    expect(s.sends()[0]).toMatchObject({ status: "unknown", reason: "delivery_outcome_unknown" }); expect(s.provider.privateReply).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([false,true])("a delayed same-attempt private ACK upgrades recovered unknown to sent (revoked=%s)", async (revoked) => {
    const s = await setup(); await s.decision("grant",0); let entered!: () => void, finish!: (reply: Awaited<ReturnType<typeof sendPrivateReply>>) => void;
    const ready = new Promise<void>((resolve) => { entered=resolve; });
    s.provider.privateReply.mockImplementationOnce(async () => { entered(); return new Promise((resolve) => { finish=resolve; }); });
    const pending=s.send(); await ready;
    const token=s.sends()[0]!.dm_attempt_token;
    vi.mocked(Date.now).mockReturnValue(NOW+60_001); await s.sender.retryQueuedDms(s.env);
    expect(s.sends()[0]).toMatchObject({ status: "unknown", dm_attempt_token: token, sent_at: null });
    if (revoked) await s.decision("revoke",1);
    finish({ ok: true, data: { message_id: "fake-late-ack" } }); await pending;
    expect(s.sends()[0]).toMatchObject({ status: "sent", dm_attempt_token: token, sent_at: NOW+60_001, reason: null });
    await s.sender.retryQueuedDms(s.env); expect(s.provider.privateReply).toHaveBeenCalledOnce(); expect(s.provider.publicReply).toHaveBeenCalledTimes(revoked ? 0 : 1); expect(fetch).not.toHaveBeenCalled();
  });
  it("a late ACK cannot overwrite a different attempt token or run its public followup", async () => {
    const s=await setup(); await s.decision("grant",0); let entered!: () => void, finish!: (reply: Awaited<ReturnType<typeof sendPrivateReply>>) => void;
    const ready=new Promise<void>((resolve) => { entered=resolve; });
    s.provider.privateReply.mockImplementationOnce(async () => { entered(); return new Promise((resolve) => { finish=resolve; }); });
    const pending=s.send(); await ready;
    s.db.exec("UPDATE keyword_dm_sends SET dm_attempt_token='different-attempt'");
    finish({ ok: true, data: { message_id: "fake-old-ack" } }); await pending;
    expect(s.sends()[0]).toMatchObject({ status: "sending", dm_attempt_token: "different-attempt", sent_at: null });
    expect(s.provider.privateReply).toHaveBeenCalledOnce(); expect(s.provider.publicReply).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("a private ACK after parent deletion recreates no send row and performs no public followup", async () => {
    const s=await setup(); await s.decision("grant",0); let entered!: () => void, finish!: (reply: Awaited<ReturnType<typeof sendPrivateReply>>) => void;
    const ready=new Promise<void>((resolve) => { entered=resolve; });
    s.provider.privateReply.mockImplementationOnce(async () => { entered(); return new Promise((resolve) => { finish=resolve; }); });
    const pending=s.send(); await ready; s.db.exec("DELETE FROM keyword_dm_rules WHERE id='rule'");
    finish({ ok: true, data: { message_id: "fake-deleted-parent-ack" } }); await pending;
    expect(s.sends()).toEqual([]); expect(s.provider.privateReply).toHaveBeenCalledOnce(); expect(s.provider.publicReply).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps the allowed fake path within the native D1 statement/bind budget", async () => {
    const s = await setup(); await s.decision("grant",0); let physical = 0, maxBinds = 0, maxSql = 0, maxBytes = 0;
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement,{ get(target,key) {
      if (key === "bind") return (...args: unknown[]) => { maxBinds=Math.max(maxBinds,args.length); maxBytes=Math.max(maxBytes,new TextEncoder().encode(JSON.stringify(args)).byteLength); return wrap(target.bind(...args)); };
      if (["first","all","raw","run"].includes(String(key))) return (...args: unknown[]) => { physical++; return Reflect.get(target,key).apply(target,args); };
      return Reflect.get(target,key);
    } });
    const d1 = { ...s.d1, prepare: (text: string) => { maxSql=Math.max(maxSql,new TextEncoder().encode(text).byteLength); return wrap(s.d1.prepare(text)); },batch: (items: D1PreparedStatement[]) => { physical+=items.length; return s.d1.batch(items); } } as D1Database;
    await s.sender.handleComment(getDb(d1),{ ...s.env, DB: d1 },"brand",comment(),NOW);
    expect(s.provider.privateReply).toHaveBeenCalledOnce(); expect(physical).toBeLessThanOrEqual(50); expect(maxBinds).toBeLessThanOrEqual(100); expect(maxSql).toBeLessThan(100_000); expect(maxBytes).toBeLessThan(64*1024); expect(fetch).not.toHaveBeenCalled();
  });
  it("0038 preserves all old send columns, uniqueness and FK behavior while granting no consent", async () => {
    const s = await createSqliteD1({ migrateThrough: 37 }); closes.push(s.close);
    s.db.exec(`INSERT INTO workspaces(id,name,created_at) VALUES('w','Synthetic',1);
      INSERT INTO short_links(id,workspace_id,channel_key,slug,destination_type,destination_url,utm,og,created_at) VALUES('link','w','test','slug','url','https://example.invalid','{}','{}',1);
      INSERT INTO keyword_dm_rules(id,workspace_id,ig_media_id,keywords,message,public_reply_variants,created_at,updated_at) VALUES('rule','w','media','[]','PRIVATE-BODY','[]',1,1);`);
    const insert = s.db.prepare("INSERT INTO keyword_dm_sends(id,rule_id,comment_id,ig_user_id,username,comment_text,comment_at,sent_at,status,reason,link_id) VALUES(?,'rule',?,'actor','PRIVATE-NAME','PRIVATE-COMMENT',1,2,?,'old-reason','link')");
    for (const status of ["queued","failed","sent","expired","already_sent"]) insert.run(status,status,status);
    const before=s.db.prepare("SELECT * FROM keyword_dm_sends ORDER BY id").all();
    const fs=await import("node:fs" as string) as { readFileSync(path: string, encoding: string): string };
    const ddl=fs.readFileSync("migrations/0038_dm_channel_consent.sql","utf8"), statements: string[]=[];
    let current="", trigger=false;
    for (const line of ddl.split("\n")) {
      current+=line+"\n"; if (line.startsWith("CREATE TRIGGER")) trigger=true;
      if (trigger ? line.trim()==="END;" : line.trim().endsWith(";") && !line.trim().startsWith("--")) { statements.push(current); current=""; trigger=false; }
    }
    expect(current.trim()).toBe("");
    const schemaBefore=s.db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
    const drop=statements.findIndex((text) => text.includes("DROP TABLE keyword_dm_sends;")); expect(drop).toBeGreaterThan(0);
    await expect(s.d1.batch([...statements.slice(0,drop+1),"SELECT json('injected_ddl_failure');",...statements.slice(drop+1)].map((text) => s.d1.prepare(text)))).rejects.toThrow();
    expect(s.db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all()).toEqual(schemaBefore);
    expect(s.db.prepare("SELECT * FROM keyword_dm_sends ORDER BY id").all()).toEqual(before);
    await s.d1.batch(statements.map((text) => s.d1.prepare(text)));
    expect(s.db.prepare("SELECT id,rule_id,comment_id,ig_user_id,username,comment_text,comment_at,sent_at,status,reason,link_id FROM keyword_dm_sends ORDER BY id").all()).toEqual(before);
    expect(s.db.prepare("SELECT * FROM dm_channel_consents").all()).toEqual([]); expect(s.db.prepare("SELECT * FROM dm_consent_receipts").all()).toEqual([]);
    expect(() => insert.run("duplicate","queued","queued")).toThrow();
    s.db.exec("UPDATE keyword_dm_sends SET status='sending' WHERE id='queued'; UPDATE keyword_dm_sends SET status='unknown' WHERE id='queued'");
    expect(() => s.db.exec("UPDATE keyword_dm_sends SET status='invalid' WHERE id='queued'")).toThrow();
    s.db.exec("DELETE FROM short_links WHERE id='link'");
    expect(s.db.prepare("SELECT link_id FROM keyword_dm_sends").all().every((row) => row.link_id===null)).toBe(true);
    s.db.exec("DELETE FROM keyword_dm_rules WHERE id='rule'"); expect(s.db.prepare("SELECT * FROM keyword_dm_sends").all()).toEqual([]); expect(s.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("removing the sender cascades hashed consent evidence and never changes a lead", async () => {
    const s = await setup(); await s.decision("grant",0); const before = s.db.prepare("SELECT * FROM leads").all();
    s.db.exec("DELETE FROM ig_connections WHERE id='sender'");
    expect(s.db.prepare("SELECT * FROM dm_channel_consents").all()).toEqual([]); expect(s.db.prepare("SELECT * FROM dm_consent_receipts").all()).toEqual([]);
    expect(s.db.prepare("SELECT * FROM leads").all()).toEqual(before); expect(s.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
