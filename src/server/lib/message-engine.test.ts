import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createSqliteD1 } from "../test/sqlite-d1";
import { getDb } from "../db";
import type { AppEnv, Auth } from "../types";
import { createMessageEngine, enqueueMessageMaintenance, messageEngine } from "./message-engine";
import { MESSAGE_DAY, MESSAGE_LEASE, MESSAGE_RETRY, MESSAGE_WINDOW, messageCsrf } from "./message-delivery-common";
import { productionMessagePolicy, type MessagePolicy } from "./message-policy";
import type { QueuedEmailProvider, QueuedEmailResult } from "./message-provider";
import { createBroadcastRoutes } from "../routes/messaging/broadcasts";
import { ApiError, errorBody } from "./errors";
import { recordEmailBounce } from "./resend-webhook";
import { spawnSync } from "node:child_process";

const NOW = Date.parse("2026-11-01T03:00:00Z"), KEY = "local-message-encryption-key";
const allow: MessagePolicy = { configured: true, condition: () => ({ sql: "1", params: [] }) };
const closers: (() => void)[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("external transport forbidden"); })); });
afterEach(() => { closers.splice(0).forEach((fn) => fn()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup(count = 1, policy: MessagePolicy = allow, provider?: QueuedEmailProvider) {
  const base = await createSqliteD1(); closers.push(base.close); const { db } = base;
  db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w','LOCAL',1),('other','OTHER',1)");
  db.exec("INSERT INTO users(id,email,password_hash,name,phone_verified_at,created_at) VALUES('u','local@example.invalid','','LOCAL',1,1)");
  db.exec("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES('w','u','owner',1)");
  db.prepare("INSERT INTO sessions(id,user_id,current_workspace_id,expires_at,created_at) VALUES('session','u','w',?,1)").run(NOW + 2 * MESSAGE_DAY);
  db.exec("INSERT INTO lead_groups(id,workspace_id,name,rules,created_at) VALUES('group','w','LOCAL','{\"all\":[]}',1)");
  db.exec("INSERT INTO forms(id,workspace_id,title,fields,after_submit,created_at) VALUES('form','w','LOCAL','{\"base\":[],\"questions\":[]}','{\"type\":\"text\",\"text\":\"LOCAL\"}',1)");
  const insert = db.prepare("INSERT INTO leads(id,workspace_id,email,name,answers,marketing_opt_in,unsubscribe_token,first_source,last_source,created_at) VALUES(?,'w',?,'LOCAL','{}',1,?,'{}','{}',1)");
  for (let i = 0; i < count; i++) insert.run("lead-" + i, `local-${i}@example.invalid`, "unsubscribe-local-" + i);
  const template = { subject: "LOCAL {{이름}}", preview: "", body: "LOCAL BODY", buttonLabel: "", buttonUrl: "" };
  db.prepare("INSERT INTO broadcasts(id,workspace_id,name,channel,kind,audience,template,status,generation,created_at,updated_at) VALUES('bc','w','LOCAL','email','info',?,?,'draft','generation',1,1)").run(JSON.stringify({ groupIds: ["group"], tagIds: [] }), JSON.stringify(template));
  const messages: { body: { type: string; payload: unknown } }[] = [];
  const sendBatch = vi.fn(async (rows: { body: { type: string; payload: unknown } }[]) => { messages.push(...rows); });
  const env = { DB: base.d1, PIPELINE: { sendBatch }, APP_URL: "https://app.test", TOKEN_ENC_KEY: KEY, RESEND_API_KEY: "local-provider-key", EMAIL_FROM: "Local <no-reply@sender.company.dev>" } as unknown as Env;
  const auth: Auth = { user: { id: "u", email: "local@example.invalid", name: "LOCAL" }, workspace: { id: "w", name: "LOCAL", plan: "starter", onboardedAt: 1 }, role: "owner", sessionId: "session", phone: null, phoneVerified: true };
  const sent = vi.fn<QueuedEmailProvider>(provider ?? (async (_env, _body, id) => ({ kind: "accepted", id: "provider-" + id })));
  const engine = createMessageEngine(policy, sent);
  const stage = async () => { const id = crypto.randomUUID(); await engine.requestBroadcast(env, auth, "w", "bc", { requestId: id, generation: "generation", scheduledAt: null }); await engine.prepare({ id }, env); return id; };
  const delivery = () => String(db.prepare("SELECT id FROM message_deliveries ORDER BY id LIMIT 1").all()[0]!.id);
  return { ...base, env, auth, engine, sent, sendBatch, messages, stage, delivery, template };
}
function meter(base: D1Database) {
  const statements = new Map<string, unknown[]>();
  let value = { physical: 0, calls: 0, bind: 0, sqlBytes: 0, resultBytes: 0 };
  const observe = (result: unknown) => { value.resultBytes = Math.max(value.resultBytes, new TextEncoder().encode(JSON.stringify(result) ?? "").byteLength); return result; };
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => new Proxy(statement, { get(target, key) {
    if (key === "bind") return (...params: unknown[]) => { value.bind = Math.max(value.bind, params.length); statements.set(sql, params); return wrap(target.bind(...params), sql); };
    if (["first", "all", "run", "raw"].includes(String(key))) return async (...args: unknown[]) => { value.physical++; value.calls++; return observe(await Reflect.get(target, key).apply(target, args)); };
    return Reflect.get(target, key);
  } });
  return { db: { ...base, prepare: (sql: string) => { value.sqlBytes = Math.max(value.sqlBytes, new TextEncoder().encode(sql).byteLength); statements.set(sql, []); return wrap(base.prepare(sql), sql); }, batch: async (statements: D1PreparedStatement[]) => { value.physical += statements.length; value.calls++; return observe(await base.batch(statements)); } } as D1Database, statements, value: () => value, reset: () => { value = { physical: 0, calls: 0, bind: 0, sqlBytes: 0, resultBytes: 0 }; } };
}

describe("durable message engine", () => {
  it("production policy is deny with no Env/HTTP override and no real transport", async () => {
    const s = await setup(1, productionMessagePolicy);
    await expect(s.engine.requestBroadcast(s.env, s.auth, "w", "bc", { requestId: crypto.randomUUID(), generation: "generation", scheduledAt: null })).rejects.toMatchObject({ code: "send_policy_unconfigured" });
    expect(s.db.prepare("SELECT count(*) AS n FROM message_runs").all()).toEqual([{ n: 0 }]); expect(s.sent).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("materializes and completes exactly once across duplicate prepare/send calls", async () => {
    const s = await setup(), run = await s.stage(), id = s.delivery();
    await s.engine.prepare({ id: run }, s.env); await Promise.all([s.engine.send({ id }, s.env), s.engine.send({ id }, s.env)]);
    expect(s.sent).toHaveBeenCalledOnce();
    expect(s.db.prepare("SELECT status,target_count,completed_count,accepted_count,snapshot_enc FROM message_runs").all()).toEqual([{ status: "completed", target_count: 1, completed_count: 1, accepted_count: 1, snapshot_enc: null }]);
    expect(s.db.prepare("SELECT status,payload_enc,recipient_hmac FROM message_deliveries").all()).toEqual([{ status: "accepted", payload_enc: null, recipient_hmac: null }]);
    expect(s.db.prepare("SELECT count(*) AS n FROM message_logs").all()).toEqual([{ n: 1 }]);
  });
  it("holds the first frozen bytes/key through response loss and never re-renders changed profile names", async () => {
    const s = await setup(); s.sent.mockResolvedValueOnce({ kind: "uncertain", code: "provider_unconfirmed" }); await s.stage(); const id = s.delivery();
    await s.engine.send({ id }, s.env); s.db.exec("UPDATE leads SET name='CHANGED' WHERE id='lead-0'"); vi.mocked(Date.now).mockReturnValue(NOW + MESSAGE_RETRY);
    await s.engine.send({ id }, s.env);
    expect(s.sent).toHaveBeenCalledTimes(2); expect(s.sent.mock.calls[0]![1]).toBe(s.sent.mock.calls[1]![1]); expect(s.sent.mock.calls[0]![2]).toBe(s.sent.mock.calls[1]![2]);
    expect(s.sent.mock.calls[1]![1]).not.toContain("CHANGED");
  });
  it.each(["EMAIL_FROM", "RESEND_API_KEY", "TOKEN_ENC_KEY"])("missing %s stays zero HTTP and does not start the provider window", async (missing) => {
    const s = await setup(); await s.stage(); delete s.env[missing as keyof Env];
    await s.engine.send({ id: s.delivery() }, s.env); expect(s.sent).not.toHaveBeenCalled();
    expect(s.db.prepare("SELECT status,first_http_at,payload_enc FROM message_deliveries").all()).toEqual([{ status: "blocked", first_http_at: null, payload_enc: null }]);
  });
  it.each(["role", "remove", "phone", "unsubscribed", "bounced", "soft", "rejoin"])("%s revocation remains closed after restoration/new registration", async (change) => {
    const s = await setup(); await s.stage(); const id = s.delivery();
    if (change === "role") { s.db.exec("UPDATE members SET role='viewer' WHERE workspace_id='w'"); s.db.exec("UPDATE members SET role='owner' WHERE workspace_id='w'"); }
    if (change === "phone") { s.db.exec("UPDATE users SET phone_verified_at=NULL"); s.db.exec("UPDATE users SET phone_verified_at=2"); }
    if (change === "remove") { s.db.exec("DELETE FROM members WHERE workspace_id='w'"); s.db.exec("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES('w','u','owner',2)"); }
    if (change === "unsubscribed") { s.db.exec("UPDATE leads SET unsubscribed_at=2"); s.db.exec("UPDATE leads SET unsubscribed_at=NULL"); }
    if (change === "bounced") { s.db.exec("UPDATE leads SET bounced_at=2"); s.db.exec("UPDATE leads SET bounced_at=NULL"); }
    if (change === "soft") { s.db.exec("UPDATE leads SET deleted_at=2"); s.db.exec("UPDATE leads SET deleted_at=NULL"); }
    if (change === "rejoin") { s.db.exec("DELETE FROM leads"); s.db.exec("INSERT INTO leads(id,workspace_id,email,answers,unsubscribe_token,first_source,last_source,created_at) VALUES('new','w','local-0@example.invalid','{}','new-unsub','{}','{}',2)"); }
    await s.engine.send({ id }, s.env); expect(s.sent).not.toHaveBeenCalled();
    expect(s.db.prepare("SELECT status,payload_enc FROM message_deliveries WHERE id=?").all(id)).toEqual([{ status: "cancelled", payload_enc: null }]);
  });
  it("ad night is deferred, including retries, while informational email retains its consent rules", async () => {
    const s = await setup(); s.db.exec("UPDATE broadcasts SET kind='ad',generation='ad' WHERE id='bc'");
    const run = crypto.randomUUID(); await s.engine.requestBroadcast(s.env, s.auth, "w", "bc", { requestId: run, generation: "ad", scheduledAt: null }); await s.engine.prepare({ id: run }, s.env);
    vi.mocked(Date.now).mockReturnValue(Date.parse("2026-11-01T12:00:00Z")); await s.engine.send({ id: s.delivery() }, s.env);
    expect(s.sent).not.toHaveBeenCalled(); expect(s.db.prepare("SELECT status,first_http_at FROM message_deliveries").all()).toEqual([{ status: "deferred", first_http_at: null }]);
    vi.mocked(Date.now).mockReturnValue(Date.parse("2026-11-01T23:00:00Z")); await s.engine.send({ id: s.delivery() }, s.env); expect(s.sent).toHaveBeenCalledOnce();
  });
  it("closes ambiguous attempts at the first24h window without a new key or HTTP", async () => {
    const s = await setup(); s.sent.mockResolvedValueOnce({ kind: "uncertain", code: "provider_unconfirmed" }); await s.stage(); const id = s.delivery(); await s.engine.send({ id }, s.env);
    vi.mocked(Date.now).mockReturnValue(NOW + MESSAGE_WINDOW); await s.engine.send({ id }, s.env);
    expect(s.sent).toHaveBeenCalledOnce(); expect(s.db.prepare("SELECT status,payload_enc FROM message_deliveries").all()).toEqual([{ status: "unknown", payload_enc: null }]);
  });
  it("known early bounce survives past the old10m wait and applies only after provider ID confirmation", async () => {
    const s = await setup(); const run = await s.stage(), id = s.delivery();
    s.sent.mockImplementationOnce(async () => {
      expect(await recordEmailBounce(s.env.DB, { type: "email.bounced", created_at: new Date(NOW).toISOString(), data: { email_id: "confirmed-provider", to: ["local-0@example.invalid"], tags: { message_log_id: id } } }, KEY)).toBe("recorded");
      expect(s.db.prepare("SELECT bounced_at FROM leads").all()).toEqual([{ bounced_at: null }]);
      return { kind: "uncertain", code: "provider_unconfirmed" };
    });
    await s.engine.send({ id }, s.env); vi.mocked(Date.now).mockReturnValue(NOW + 15 * 60_000); s.sent.mockResolvedValueOnce({ kind: "accepted", id: "confirmed-provider" });
    await s.engine.send({ id }, s.env);
    expect(s.db.prepare("SELECT bounced_at FROM leads").all()).toEqual([{ bounced_at: NOW }]);
    expect(s.db.prepare("SELECT status FROM message_logs").all()).toEqual([{ status: "bounced" }]);
    expect(s.db.prepare("SELECT accepted_count,completed_count FROM message_runs WHERE id=?").all(run)).toEqual([{ accepted_count: 1, completed_count: 1 }]);
    expect(s.db.prepare("SELECT count(*) AS n FROM email_bounce_pending").all()).toEqual([{ n: 0 }]);
  });
  it("broadcast cancellation during HTTP cannot erase accepted opaque evidence or recreate deleted contacts", async () => {
    const s = await setup(); const run = await s.stage(), id = s.delivery(); let finish!: (value: QueuedEmailResult) => void;
    s.sent.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const work = s.engine.send({ id }, s.env); await vi.waitFor(() => expect(s.sent).toHaveBeenCalledOnce());
    await s.engine.cancelBroadcast(s.env, s.auth, "w", "bc", "generation"); s.db.exec("DELETE FROM leads");
    finish({ kind: "accepted", id: "accepted-after-cancel" }); await work;
    expect(s.db.prepare("SELECT status,provider_id FROM message_delivery_receipts").all()).toEqual([{ status: "accepted", provider_id: "accepted-after-cancel" }]);
    expect(s.db.prepare("SELECT count(*) AS n FROM message_logs").all()).toEqual([{ n: 0 }]);
    expect(s.db.prepare("SELECT count(*) AS n FROM leads").all()).toEqual([{ n: 0 }]);
    expect(s.db.prepare("SELECT accepted_count,completed_count FROM message_runs WHERE id=?").all(run)).toEqual([{ accepted_count: 1, completed_count: 1 }]);
  });
  it("Cron discovers no recipient profiles and only enqueues bounded maintenance", async () => {
    const s = await setup(), counted = meter(s.d1); s.env.DB = counted.db;
    await enqueueMessageMaintenance(s.env); expect(counted.value().physical).toBe(0); expect(s.sent).not.toHaveBeenCalled();
    expect(s.sendBatch).toHaveBeenCalledWith([{ body: { type: "message_maintenance", payload: {} } }]);
  });
  it("automation hooks create one shared durable run and never expose it to the old pending sender", async () => {
    const s = await setup(); s.db.prepare("INSERT INTO automations(id,workspace_id,name,trigger,target,delay_minutes,channel,kind,template,enabled,generation,authorized_by,authorization_generation,created_at,updated_at) VALUES('auto','w','LOCAL','form_submitted','{\"formId\":\"form\"}',0,'email','info',?,1,'auto-gen','u','grant',1,1)").run(JSON.stringify(s.template));
    const event = { workspaceId: "w", trigger: "form_submitted" as const, leadId: "lead-0", ref: { id: "form", guideId: null } };
    await Promise.all([s.engine.enqueueAutomation(getDb(s.env.DB), event), s.engine.enqueueAutomation(getDb(s.env.DB), event)]);
    expect(s.db.prepare("SELECT count(*) AS n FROM automation_runs WHERE status='pending'").all()).toEqual([{ n: 0 }]);
    const run = String(s.db.prepare("SELECT id FROM message_runs").all()[0]!.id); await s.engine.prepare({ id: run }, s.env); await s.engine.send({ id: s.delivery() }, s.env);
    expect(s.sent).toHaveBeenCalledOnce(); expect(s.db.prepare("SELECT status FROM automation_runs").all()).toEqual([{ status: "sent" }]);
  });
  it("new API rejects missing production policy before any request can schedule mail", async () => {
    const s = await setup(), app = new Hono<AppEnv>();
    app.use("*", async (c, next) => { c.set("auth", s.auth); c.set("db", getDb(c.env.DB)); await next(); }); app.route("/broadcasts", createBroadcastRoutes(messageEngine));
    app.onError((error, c) => error instanceof ApiError ? c.json(errorBody(error.code, error.message), error.status) : c.json({}, 500));
    const response = await app.request("/broadcasts/bc/send", { method: "POST", headers: { Origin: s.env.APP_URL, "X-Message-Workspace": "w", "Content-Type": "application/json", "X-CSRF-Token": await messageCsrf(s.env, s.auth, "w") }, body: JSON.stringify({ requestId: crypto.randomUUID(), generation: "generation", scheduledAt: null }) }, s.env);
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ error: { code: "send_policy_unconfigured" } });
    expect(s.db.prepare("SELECT status FROM broadcasts").all()).toEqual([{ status: "draft" }]); expect(fetch).not.toHaveBeenCalled();
  });
  it("final atomic HTTP-intent await crossing21:00 yields zero HTTP, no false first attempt and08:00 resumption", async () => {
    const s = await setup(); s.db.exec("UPDATE broadcasts SET kind='ad',generation='ad' WHERE id='bc'");
    const run = crypto.randomUUID(); await s.engine.requestBroadcast(s.env, s.auth, "w", "bc", { requestId: run, generation: "ad", scheduledAt: null }); await s.engine.prepare({ id: run }, s.env);
    const id = s.delivery(), base = s.env.DB, before = Date.parse("2026-11-01T11:59:59.999Z"), night = before + 1, morning = Date.parse("2026-11-01T23:00:00Z");
    vi.mocked(Date.now).mockReturnValue(before);
    s.env.DB = { ...base, batch: async (statements: D1PreparedStatement[]) => {
      const result = await base.batch(statements);
      if (result[0]?.results[0] && typeof result[0].results[0] === "object" && "first_http_at" in result[0].results[0]) vi.mocked(Date.now).mockReturnValue(night);
      return result;
    } } as D1Database;
    await s.engine.send({ id }, s.env); expect(s.sent).not.toHaveBeenCalled();
    expect(s.db.prepare("SELECT status,next_attempt_at,first_http_at,last_attempt_at,attempts FROM message_deliveries").all()).toEqual([{ status: "deferred", next_attempt_at: morning, first_http_at: null, last_attempt_at: null, attempts: 0 }]);
    expect(s.db.prepare("SELECT count(*) n FROM message_delivery_receipts").all()).toEqual([{ n: 0 }]);
    s.env.DB = base; vi.mocked(Date.now).mockReturnValue(morning); await s.engine.send({ id }, s.env);
    expect(s.sent).toHaveBeenCalledOnce(); const body = JSON.parse(s.sent.mock.calls[0]![1]);
    expect(body.subject).toContain("(광고)"); expect(body.text).toContain("LOCAL"); expect(body.text).toContain("https://app.test/unsubscribe/unsubscribe-local-0");
  });
  it.each(["role", "consent", "policy"])("last atomic attempt denies %s changed after profile/crypto awaits", async (change) => {
    const conditional: MessagePolicy = { configured: true, condition: (context) => ({ sql: context.phase === "attempt" ? "EXISTS(SELECT 1 FROM workspaces WHERE id='w' AND name='LOCAL')" : "1", params: [] }) };
    const s = await setup(1, conditional); if (change === "consent") s.db.exec("UPDATE broadcasts SET kind='ad',generation='ad'");
    const run = crypto.randomUUID(), generation = change === "consent" ? "ad" : "generation";
    await s.engine.requestBroadcast(s.env, s.auth, "w", "bc", { requestId: run, generation, scheduledAt: null }); await s.engine.prepare({ id: run }, s.env);
    const base = s.env.DB; let ready = false;
    s.env.DB = { ...base, batch: async (statements: D1PreparedStatement[]) => {
      if (statements.length === 3 && !ready) { ready = true; if (change === "role") s.db.exec("UPDATE members SET role='viewer'"); else if (change === "consent") s.db.exec("UPDATE leads SET marketing_opt_in=0"); else s.db.exec("UPDATE workspaces SET name='DENIED' WHERE id='w'"); }
      return base.batch(statements);
    } } as D1Database;
    await s.engine.send({ id: s.delivery() }, s.env); expect(s.sent).not.toHaveBeenCalled();
    expect(s.db.prepare("SELECT count(*) n FROM message_delivery_receipts").all()).toEqual([{ n: 0 }]);
    expect(s.db.prepare("SELECT status,payload_enc FROM message_deliveries").all()).toEqual([{ status: change === "policy" ? "blocked" : "cancelled", payload_enc: null }]);
  });
  it("accepted transaction response loss replays no HTTP and counts accepted once", async () => {
    const s = await setup(); await s.stage(); const id = s.delivery(), base = s.env.DB; let lost = false;
    s.env.DB = { ...base, batch: async (statements: D1PreparedStatement[]) => { const result = await base.batch(statements); if (statements.length === 5 && !lost) { lost = true; throw new Error("local lost commit response"); } return result; } } as D1Database;
    await expect(s.engine.send({ id }, s.env)).rejects.toThrow("message_delivery_failed");
    await s.engine.send({ id }, s.env); expect(s.sent).toHaveBeenCalledOnce();
    expect(s.db.prepare("SELECT accepted_count,completed_count,status FROM message_runs").all()).toEqual([{ accepted_count: 1, completed_count: 1, status: "completed" }]);
    expect(s.db.prepare("SELECT count(*) n FROM message_logs").all()).toEqual([{ n: 1 }]);
  });
  it("late first claimant cannot change a newer claimant outcome and reuses identical provider bytes", async () => {
    const s = await setup(); await s.stage(); const id = s.delivery(); let finish!: (value: QueuedEmailResult) => void;
    s.sent.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce({ kind: "accepted", id: "same-id" });
    const first = s.engine.send({ id }, s.env); await vi.waitFor(() => expect(s.sent).toHaveBeenCalledOnce());
    vi.mocked(Date.now).mockReturnValue(NOW + MESSAGE_LEASE + 1); await s.engine.send({ id }, s.env);
    finish({ kind: "uncertain", code: "provider_unconfirmed" }); await first;
    expect(s.sent).toHaveBeenCalledTimes(2); expect(s.sent.mock.calls[0]![1]).toBe(s.sent.mock.calls[1]![1]); expect(s.sent.mock.calls[0]![2]).toBe(s.sent.mock.calls[1]![2]);
    expect(s.db.prepare("SELECT status,provider_id FROM message_deliveries").all()).toEqual([{ status: "accepted", provider_id: "same-id" }]);
    expect(s.db.prepare("SELECT accepted_count,completed_count FROM message_runs").all()).toEqual([{ accepted_count: 1, completed_count: 1 }]);
  });
  it.each(["RESEND_API_KEY", "TOKEN_ENC_KEY"])("rotating %s after uncertain HTTP never uses a new sender or payload", async (field) => {
    const s = await setup(); await s.stage(); s.sent.mockResolvedValueOnce({ kind: "uncertain", code: "provider_unconfirmed" }); await s.engine.send({ id: s.delivery() }, s.env);
    s.env[field as "RESEND_API_KEY"] = "local-rotated-key"; vi.mocked(Date.now).mockReturnValue(NOW + MESSAGE_RETRY); await s.engine.send({ id: s.delivery() }, s.env);
    expect(s.sent).toHaveBeenCalledOnce(); expect(s.db.prepare("SELECT status,payload_enc,recipient_hmac FROM message_deliveries").all()).toEqual([{ status: "unknown", payload_enc: null, recipient_hmac: null }]);
  });
  it("parent deletion scrubs every contact payload while retaining only opaque provider evidence", async () => {
    const s = await setup(); await s.stage(); s.sent.mockResolvedValueOnce({ kind: "uncertain", code: "provider_unconfirmed" }); await s.engine.send({ id: s.delivery() }, s.env);
    s.db.exec("DELETE FROM workspaces WHERE id='w'");
    for (const table of ["message_runs", "message_deliveries", "message_logs", "email_bounce_pending"]) expect(s.db.prepare(`SELECT count(*) n FROM ${table}`).all()).toEqual([{ n: 0 }]);
    const receipts = s.db.prepare("SELECT * FROM message_delivery_receipts").all(); expect(receipts).toHaveLength(1); expect(receipts[0]!.status).toBe("unknown");
    expect(JSON.stringify(receipts)).not.toMatch(/example|LOCAL|lead-|unsubscribe|body|workspace/);
    vi.mocked(Date.now).mockReturnValue(NOW + 31 * MESSAGE_DAY); await s.engine.maintain({}, s.env);
    expect(s.db.prepare("SELECT count(*) n FROM message_delivery_receipts").all()).toEqual([{ n: 0 }]);
  });
  it("queue outage preserves materialized work for bounded same-ID discovery", async () => {
    const s = await setup(); s.sendBatch.mockRejectedValueOnce(new Error("local queue outage")); const id = crypto.randomUUID();
    await s.engine.requestBroadcast(s.env, s.auth, "w", "bc", { requestId: id, generation: "generation", scheduledAt: null });
    expect(s.db.prepare("SELECT status FROM message_runs").all()).toEqual([{ status: "scheduled" }]);
    await s.engine.maintain({}, s.env); expect(s.messages.some((m) => m.body.type === "prepare_message_run")).toBe(true); await s.engine.prepare({ id }, s.env); expect(s.db.prepare("SELECT count(*) n FROM message_deliveries").all()).toEqual([{ n: 1 }]);
  });
  it("20k audience with3000 local fake accepts stays bounded per invocation and never loads an all-leads JS result", async () => {
    const s = await setup(20_000), counted = meter(s.d1); s.env.DB = counted.db;
    const maximum = { physical: 0, calls: 0, bind: 0, sqlBytes: 0, resultBytes: 0 };
    const check = () => { const value = counted.value(); for (const key of Object.keys(maximum) as (keyof typeof maximum)[]) maximum[key] = Math.max(maximum[key], value[key]); expect(value.physical).toBeLessThanOrEqual(50); expect(value.bind).toBeLessThanOrEqual(100); expect(value.sqlBytes).toBeLessThanOrEqual(100_000); expect(value.resultBytes).toBeLessThan(1_500_000); counted.reset(); };
    await s.stage(); check();
    expect(s.db.prepare("SELECT target_count,eligible_count FROM message_runs").all()).toEqual([{ target_count: 20_000, eligible_count: 20_000 }]);
    await s.engine.dispatch({}, s.env); check();
    expect(s.sendBatch.mock.calls.every(([batch]) => batch.length <= 100)).toBe(true);
    const ids = s.db.prepare("SELECT id FROM message_deliveries ORDER BY id LIMIT 3000").all().map((r) => String(r.id));
    for (const id of ids) { await s.engine.send({ id }, s.env); check(); }
    await s.engine.maintain({}, s.env); check();
    expect(s.sent).toHaveBeenCalledTimes(3000); expect(fetch).not.toHaveBeenCalled();
    expect(s.db.prepare("SELECT accepted_count,completed_count,status,target_count FROM message_runs").all()).toEqual([{ accepted_count: 3000, completed_count: 3000, status: "ready", target_count: 20_000 }]);
    // Compile captured real statements against all real migrations under hosted
    // D1's tighter physical limits. EXPLAIN executes no provider/query mutation.
    const proof = spawnSync("python3", ["-c", `import sqlite3,json,sys,pathlib
p=json.load(sys.stdin); d=sqlite3.connect(':memory:')
for f in sorted(pathlib.Path('migrations').glob('*.sql')): d.executescript(f.read_text())
for kind,value in [(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT,5),(sqlite3.SQLITE_LIMIT_COLUMN,100),(sqlite3.SQLITE_LIMIT_EXPR_DEPTH,100),(sqlite3.SQLITE_LIMIT_SQL_LENGTH,100000),(sqlite3.SQLITE_LIMIT_FUNCTION_ARG,32),(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER,100),(sqlite3.SQLITE_LIMIT_VDBE_OP,21504)]: d.setlimit(kind,value)
m=0
for sql,args in p:
 rows=d.execute('EXPLAIN '+sql,args).fetchall(); m=max(m,len(rows))
print(json.dumps({'statements':len(p),'maxVdbe':m}))`], { cwd: process.cwd(), input: JSON.stringify([...counted.statements]), encoding: "utf8" });
    expect(proof.status, proof.stderr).toBe(0); const compiled = JSON.parse(proof.stdout); expect(compiled.statements).toBeGreaterThan(10); expect(compiled.maxVdbe).toBeLessThan(21504);
    expect(maximum).toMatchObject({ physical:17, calls:11, bind:15 });
    const pending = [...counted.statements].find(([sql]) => sql.startsWith("UPDATE leads AS l"))!;
    const plan = s.db.prepare("EXPLAIN QUERY PLAN "+pending[0]).all(...pending[1] as (string|number|null)[]);
    expect(plan.some((row) => String(row.detail).includes("SCAN l"))).toBe(false);
  }, 60_000);

  it("preparation rollback never leaves a partial audience or a sending broadcast", async () => {
    const s = await setup(3), id = crypto.randomUUID(); await s.engine.requestBroadcast(s.env, s.auth, "w", "bc", { requestId: id, generation: "generation", scheduledAt: null });
    s.db.exec("CREATE TRIGGER local_fail_delivery BEFORE INSERT ON message_deliveries WHEN NEW.lead_id='lead-1' BEGIN SELECT RAISE(ABORT,'local failure'); END");
    await expect(s.engine.prepare({ id }, s.env)).rejects.toThrow("message_prepare_failed");
    expect(s.db.prepare("SELECT count(*) n FROM message_deliveries").all()).toEqual([{ n: 0 }]);
    expect(s.db.prepare("SELECT status,enumeration_done,snapshot_enc,target_count FROM message_runs").all()).toEqual([{ status: "scheduled", enumeration_done: 0, snapshot_enc: null, target_count: 0 }]);
    expect(s.db.prepare("SELECT status FROM broadcasts").all()).toEqual([{ status: "scheduled" }]);
    s.db.exec("DROP TRIGGER local_fail_delivery"); await s.engine.prepare({ id }, s.env); expect(s.db.prepare("SELECT count(*) n FROM message_deliveries").all()).toEqual([{ n: 3 }]);
  });
  it("deleted actor immediately scrubs prepared recipient payload and cannot resume after a same-ID replacement", async () => {
    const s = await setup(); await s.stage(); const id = s.delivery(); s.sent.mockResolvedValueOnce({ kind: "uncertain", code: "provider_unconfirmed" }); await s.engine.send({ id }, s.env);
    s.db.exec("DELETE FROM users WHERE id='u'");
    expect(s.db.prepare("SELECT status,payload_enc,recipient_hmac FROM message_deliveries").all()).toEqual([{ status: "unknown", payload_enc: null, recipient_hmac: null }]);
    expect(s.db.prepare("SELECT status,snapshot_enc FROM message_runs").all()).toEqual([{ status: "cancelled", snapshot_enc: null }]);
    s.db.exec("INSERT INTO users(id,email,password_hash,name,phone_verified_at,created_at) VALUES('u','local@example.invalid','','LOCAL',2,2); INSERT INTO members(workspace_id,user_id,role,created_at) VALUES('w','u','owner',2)");
    vi.mocked(Date.now).mockReturnValue(NOW + MESSAGE_RETRY); await s.engine.send({ id }, s.env); expect(s.sent).toHaveBeenCalledOnce();
  });
  it("a logged accepted bounce needs the birth revision even when raw ID/address/createdAt are reused", async () => {
    const s = await setup(); await s.stage(); await s.engine.send({ id: s.delivery() }, s.env);
    const event = { type: "email.bounced" as const, created_at: new Date(NOW).toISOString(), data: { email_id: "provider-"+s.delivery(), to: ["local-0@example.invalid"] } };
    // Simulates the old timestamp-only proof collision without mutating the
    // provider log. Actual registration/purge also removes old logs.
    s.db.exec("UPDATE lead_import_births SET revision=revision+1 WHERE lead_id='lead-0'");
    await recordEmailBounce(s.env.DB, event, KEY); expect(s.db.prepare("SELECT bounced_at FROM leads").all()).toEqual([{ bounced_at: null }]);
  });
  it("early bounce recipient mismatch cannot poison a delivery, and response body/addresses never escape a DB failure", async () => {
    const s = await setup(); await s.stage(); const id = s.delivery();
    s.sent.mockImplementationOnce(async () => {
      const event = { type: "email.bounced" as const, created_at: new Date(NOW).toISOString(), data: { email_id: "provider", to: ["different@example.invalid"], tags: { message_log_id: id } } };
      expect(await recordEmailBounce(s.env.DB, event, KEY)).toBe("retry"); expect(s.db.prepare("SELECT count(*) n FROM email_bounce_pending").all()).toEqual([{ n: 0 }]);
      return { kind: "accepted", id: "provider" };
    });
    await s.engine.send({ id }, s.env); expect(s.db.prepare("SELECT bounced_at FROM leads").all()).toEqual([{ bounced_at: null }]);
    const broken = { prepare: () => { throw new Error("local@example.invalid private-bound-body"); } } as unknown as D1Database;
    await expect(recordEmailBounce(broken, { type: "email.bounced", created_at: new Date(NOW).toISOString(), data: { email_id: "provider", to: ["local@example.invalid"] } }, KEY)).rejects.toThrow(/^email_bounce_record_failed$/);
  });
  it("rolling legacy workers cannot claim a newly scheduled broadcast or enqueue new-rule pending work", async () => {
    const s = await setup(); await s.engine.requestBroadcast(s.env,s.auth,"w","bc",{requestId:crypto.randomUUID(),generation:"generation",scheduledAt:null});
    expect(() => s.db.exec("UPDATE broadcasts SET name='new' WHERE id='bc'")).toThrow("message_generation_required");
    s.db.exec("INSERT INTO broadcasts(id,workspace_id,name,channel,kind,audience,template,status,generation,created_at,updated_at) SELECT 'legacy',workspace_id,name,channel,kind,audience,template,'draft','legacy',1,1 FROM broadcasts WHERE id='bc'");
    expect(() => s.db.exec("UPDATE broadcasts SET status='scheduled' WHERE id='legacy'")).toThrow("message_authorization_required");
    s.db.exec("UPDATE broadcasts SET status='scheduled' WHERE id='bc'");
    expect(() => s.db.exec("UPDATE broadcasts SET status='sending' WHERE id='bc'")).toThrow("message_native_claim_required");
  });

  it("a DB error on an early return is normalized before the Queue logger and no recipient is exposed", async () => {
    const s = await setup(); await s.stage(); s.env.EMAIL_FROM = ""; const base = s.env.DB;
    const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => new Proxy(statement, { get(target,key) {
      if (key === "bind") return (...params: unknown[]) => wrap(target.bind(...params),sql);
      if (key === "run" && sql.includes("reason='no_provider'")) return () => { throw new Error("local@example.invalid private-bound-body"); };
      return Reflect.get(target,key);
    } });
    s.env.DB = { ...base, prepare: (sql: string) => wrap(base.prepare(sql),sql) } as D1Database;
    await expect(s.engine.send({ id: s.delivery() },s.env)).rejects.toThrow(/^message_delivery_failed$/); expect(s.sent).not.toHaveBeenCalled();
  });

  it("large repeated profile variables fail before allocating a huge rendered email or starting HTTP", async () => {
    const s = await setup(); s.db.prepare("UPDATE leads SET name=?").run("x".repeat(60_000));
    s.db.prepare("UPDATE broadcasts SET template=?,generation='large'").run(JSON.stringify({ ...s.template, body: "{{이름}}".repeat(2000) }));
    const id = crypto.randomUUID(); await s.engine.requestBroadcast(s.env,s.auth,"w","bc",{requestId:id,generation:"large",scheduledAt:null}); await s.engine.prepare({ id },s.env); await s.engine.send({ id:s.delivery() },s.env);
    expect(s.sent).not.toHaveBeenCalled(); expect(s.db.prepare("SELECT status,first_http_at,payload_enc FROM message_deliveries").all()).toEqual([{ status:"failed",first_http_at:null,payload_enc:null }]);
  });

  it("a15m old early bounce racing accepted commit during HMAC verification is never lost", async () => {
    const s = await setup(); await s.stage(); const id=s.delivery(); s.sent.mockResolvedValueOnce({kind:"uncertain",code:"provider_unconfirmed"}); await s.engine.send({id},s.env);
    vi.mocked(Date.now).mockReturnValue(NOW+15*60_000); let finish!:(value:QueuedEmailResult)=>void;
    s.sent.mockImplementationOnce(()=>new Promise((resolve)=>{finish=resolve;})); const sending=s.engine.send({id},s.env); await vi.waitFor(()=>expect(s.sent).toHaveBeenCalledTimes(2));
    const base=s.env.DB;
    const wrap=(statement:D1PreparedStatement,sql:string):D1PreparedStatement=>new Proxy(statement,{get(target,key){
      if(key==="bind") return (...args:unknown[])=>wrap(target.bind(...args),sql);
      if(key==="first" && sql.startsWith("SELECT d.recipient_hmac")) return async()=>{ const row=await target.first(); finish({kind:"accepted",id:"accepted-race"}); await sending; return row; };
      return Reflect.get(target,key);
    }});
    const raced={...base,prepare:(sql:string)=>wrap(base.prepare(sql),sql)} as D1Database;
    expect(await recordEmailBounce(raced,{type:"email.bounced",created_at:new Date(NOW).toISOString(),data:{email_id:"accepted-race",to:["local-0@example.invalid"],tags:{message_log_id:id}}},KEY)).toBe("recorded");
    expect(s.db.prepare("SELECT bounced_at FROM leads").all()).toEqual([{bounced_at:NOW}]); expect(s.db.prepare("SELECT status FROM message_logs").all()).toEqual([{status:"bounced"}]);
  });

  it("a valid escape-heavy frozen payload remains retryable within the encrypted storage bound", async () => {
    const s=await setup(); s.db.prepare("UPDATE leads SET name=?").run("\\".repeat(60_000));
    s.db.prepare("UPDATE broadcasts SET template=?,generation='escaped'").run(JSON.stringify({...s.template,subject:"LOCAL",body:"{{이름}}{{이름}}"}));
    const id=crypto.randomUUID(); await s.engine.requestBroadcast(s.env,s.auth,"w","bc",{requestId:id,generation:"escaped",scheduledAt:null}); await s.engine.prepare({id},s.env);
    s.sent.mockResolvedValueOnce({kind:"uncertain",code:"provider_unconfirmed"}); await s.engine.send({id:s.delivery()},s.env);
    const size=s.db.prepare("SELECT length(payload_enc) bytes FROM message_deliveries").all()[0]!.bytes; expect(Number(size)).toBeGreaterThan(1_000_000); expect(Number(size)).toBeLessThan(1_500_000);
    vi.mocked(Date.now).mockReturnValue(NOW+MESSAGE_RETRY); await s.engine.send({id:s.delivery()},s.env);
    expect(s.sent).toHaveBeenCalledTimes(2); expect(s.sent.mock.calls[0]![1]).toBe(s.sent.mock.calls[1]![1]); expect(s.db.prepare("SELECT status FROM message_deliveries").all()).toEqual([{status:"accepted"}]);
  });

});
