import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv, Auth } from "../types";
import type { PipelineMessage } from "../jobs";
import { createSqliteD1 } from "../test/sqlite-d1";
import { getDb } from "../db";
import { ApiError, errorBody } from "./errors";
import { siteAlertRoutes } from "../routes/site-alerts";
import { checkSiteAlert, maintainSiteAlerts, ALERT_SITE_BATCH, ALERT_MAIL_BATCH } from "./site-alerts";
import { sendSiteAlert } from "./site-alert-mail";
import { alertDayStart, shiftAlertDay } from "./site-alert-policy";
import type { SiteAlertStatus } from "../../shared/site-alerts";
import worker from "../index";

const NOW = Date.parse("2026-11-10T00:00:00Z"), KEY = "site-alert-test-encryption-key-long";
const close: (() => void)[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { for (const fn of close.splice(0)) fn(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup(configured = true) {
  const base = await createSqliteD1(); close.push(base.close); const { db } = base;
  db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w','QA',1),('foreign','other',1)");
  for (const [id, role] of [["owner", "owner"], ["editor", "editor"], ["viewer", "viewer"]]) {
    db.prepare("INSERT INTO users(id,email,password_hash,name,phone_verified_at,created_at) VALUES(?,?,'','QA',1,1)").run(id!, `${id}@team.test`);
    db.prepare("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES('w',?,?,1)").run(id!, role!);
    db.prepare("INSERT INTO sessions(id,user_id,current_workspace_id,expires_at,created_at) VALUES(?,?,'w',?,1)").run(`session-${id}`, id!, NOW + 3 * 86_400_000);
  }
  db.prepare("INSERT INTO sites(id,workspace_id,site_key,name,allowed_domains,first_event_at,created_at) VALUES('s','w','key','QA site','[]',?,1),('other','foreign','other-key','Other','[]',?,1)").run(alertDayStart("2026-10-01"), alertDayStart("2026-10-01"));
  for (let i = 0; i < 9; i++) db.prepare("INSERT INTO site_daily_stats(site_id,day,link_id,pageviews,conversions) VALUES('s',?,'',?,?)").run(shiftAlertDay("2026-11-01", i), i < 7 ? 100 : 10, i < 7 ? 10 : 1);
  const sent: PipelineMessage[] = [], sendBatch = vi.fn(async (items: { body: PipelineMessage }[]) => { sent.push(...items.map((item) => item.body)); });
  const env = { DB: base.d1, APP_URL: "https://app.example.test", TOKEN_ENC_KEY: KEY, PIPELINE: { sendBatch }, ...(configured && { RESEND_API_KEY: "fake-provider-key", EMAIL_FROM: "Alerts <alerts@sender.company.dev>" }) } as unknown as Env;
  const fetch = vi.fn(async () => Response.json({ id: "provider-id" })); vi.stubGlobal("fetch", fetch);
  let who = "owner";
  const auth = (): Auth => ({ user: { id: who, email: `${who}@team.test`, name: "QA" }, sessionId: `session-${who}`, workspace: { id: "w", name: "QA", plan: "starter", onboardedAt: 1 }, role: who === "owner" ? "owner" : who === "editor" ? "editor" : "viewer", phone: null, phoneVerified: true });
  const app = new Hono<AppEnv>(); app.use("*", async (c, next) => { c.set("auth", auth()); c.set("db", getDb(c.env.DB)); await next(); }); app.route("/alerts", siteAlertRoutes);
  app.onError((e, c) => e instanceof ApiError ? c.json(errorBody(e.code, e.message), e.status) : c.json(errorBody("internal_error", "failed"), 500));
  const status = async (site = "s") => (await (await app.request(`/alerts/${site}`, {}, env)).json()) as SiteAlertStatus;
  const save = async (value: SiteAlertStatus, patch: Record<string, unknown> = {}, origin = env.APP_URL) => app.request("/alerts/s", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": value.csrfToken! }, body: JSON.stringify({ settings: { ...value.policy, enabled: true }, subscribed: true, expectedGeneration: value.generation, expectedSubscriptionGeneration: value.subscriptionGeneration, ...patch }) }, env);
  const activate = async () => { const value = await status(); expect((await save(value)).status).toBe(200); return (await status()).generation!; };
  const stage = async () => { const generation = await activate(); await checkSiteAlert({ siteId: "s", generation }, env); return String(db.prepare("SELECT id FROM site_alert_mail_outbox ORDER BY created_at,id").all()[0]!.id); };
  return { ...base, env, sent, sendBatch, fetch, status, save, activate, stage, app, setWho: (value: string) => { who = value; } };
}
function meter(base: D1Database) {
  let queries = 0, maxParams = 0;
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, { get(target, key) {
    if (key === "bind") return (...params: unknown[]) => { maxParams = Math.max(maxParams, params.length); return wrap(target.bind(...params)); };
    if (["run", "all", "first", "raw"].includes(String(key))) return (...args: unknown[]) => { queries++; return Reflect.get(target, key).apply(target, args); };
    return Reflect.get(target, key);
  } });
  return { db: { ...base, prepare: (sql: string) => wrap(base.prepare(sql)), batch: async (rows: D1PreparedStatement[]) => { queries += rows.length; return base.batch(rows); } } as D1Database,
    value: () => ({ queries, maxParams }), reset: () => { queries = 0; maxParams = 0; } };
}

describe("site alert settings and detector", () => {
  it("defaults off, requires explicit self opt-in and isolates workspace/role/CSRF", async () => {
    const { status, save, app, env, setWho, db } = await setup(); const initial = await status();
    expect(initial).toMatchObject({ policy: { enabled: false, ratioPercent: 20, minimumAverage: 100, confirmationDays: 2 }, subscribed: false });
    expect((await save(initial, {}, "https://evil.test")).status).toBe(403);
    expect((await app.request("/alerts/other", {}, env)).status).toBe(404);
    setWho("viewer"); expect((await save(await status())).status).toBe(403);
    setWho("owner"); expect((await save(initial)).status).toBe(200);
    expect(db.prepare("SELECT user_id,active FROM site_alert_recipients").all()).toEqual([{ user_id: "owner", active: 1 }]);
  });
  it("concurrent saves claim one generation and stale settings cannot undo a newer choice", async () => {
    const { status, save } = await setup(); const initial = await status();
    const results = await Promise.all([save(initial), save(initial)]); expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await save(initial, { subscribed: false })).status).toBe(409);
  });
  it("twenty former recipients free capacity atomically without erasing their cooldowns", async () => {
    const { status, save, db, env, sent } = await setup();
    for (let i = 0; i < 20; i++) {
      db.prepare("INSERT INTO users(id,email,password_hash,name,phone_verified_at,created_at) VALUES(?,?,'','QA',1,1)").run(`former-${i}`, `former-${i}@team.test`);
      db.prepare("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES('w',?,'editor',1)").run(`former-${i}`);
      db.prepare("INSERT INTO site_alert_recipients(site_id,user_id,generation,active,email_hmac,last_attempt_at,last_delivery_id,created_at,updated_at) VALUES('s',?,?,1,'old-hmac',?,'prior',1,1)").run(`former-${i}`, `old-${i}`, NOW - 1000);
    }
    expect((await save(await status())).status).toBe(409); // The twenty currently eligible subscribers do count.
    for (let i = 0; i < 20; i++) {
      if (i % 2) db.prepare("DELETE FROM members WHERE workspace_id='w' AND user_id=?").run(`former-${i}`);
      else db.prepare("UPDATE members SET role='viewer' WHERE workspace_id='w' AND user_id=?").run(`former-${i}`);
    }
    const former = db.prepare("SELECT active,generation,email_hmac,last_attempt_at,last_delivery_id FROM site_alert_recipients").all();
    expect(former).toHaveLength(20); expect(former.every((row) => row.active === 0 && !String(row.generation).startsWith("old-") && row.email_hmac === null && row.last_attempt_at === NOW - 1000 && row.last_delivery_id === "prior")).toBe(true);
    expect((await save(await status())).status).toBe(200); const current = await status(); await checkSiteAlert({ siteId: "s", generation: current.generation }, env);
    expect(db.prepare("SELECT user_id FROM site_alert_mail_outbox").all()).toEqual([{ user_id: "owner" }]); expect(sent).toHaveLength(1);
  });
  it("the guarded self-save repairs stale invalid rows while preserving valid subscribers and cooldowns", async () => {
    const { status, save, db } = await setup();
    for (let i = 0; i < 20; i++) {
      db.prepare("INSERT INTO users(id,email,password_hash,name,phone_verified_at,created_at) VALUES(?,?,'','QA',1,1)").run(`stale-${i}`, `stale-${i}@team.test`);
      db.prepare("INSERT INTO site_alert_recipients(site_id,user_id,generation,active,email_hmac,last_attempt_at,created_at,updated_at) VALUES('s',?,'stale',1,'old',?,1,1)").run(`stale-${i}`, NOW);
    }
    expect((await save(await status())).status).toBe(200);
    expect(db.prepare("SELECT count(*) AS n FROM site_alert_recipients WHERE active=1").all()).toEqual([{ n: 1 }]);
    expect(db.prepare("SELECT count(*) AS n FROM site_alert_recipients WHERE user_id LIKE 'stale-%' AND active=0 AND generation<>'stale' AND email_hmac IS NULL AND last_attempt_at=?").all(NOW)).toEqual([{ n: 20 }]);
  });
  it.each(["role", "email", "workspace"])("%s change before the settings batch rolls back both settings and self opt-in", async (change) => {
    const { status, save, d1, db } = await setup(); const initial = await status(), batch = d1.batch.bind(d1); let calls = 0;
    vi.spyOn(d1, "batch").mockImplementation(async (rows) => { if (++calls === 2) {
      if (change === "role") db.exec("UPDATE members SET role='viewer' WHERE user_id='owner'");
      if (change === "email") db.exec("UPDATE users SET email='changed@team.test' WHERE id='owner'");
      if (change === "workspace") db.exec("UPDATE sessions SET current_workspace_id='foreign' WHERE user_id='owner'");
    } return batch(rows); });
    expect((await save(initial)).status).toBe(409); expect(db.prepare("SELECT count(*) AS n FROM site_alert_settings").all()).toEqual([{ n: 0 }]); expect(db.prepare("SELECT count(*) AS n FROM site_alert_recipients").all()).toEqual([{ n: 0 }]);
  });
  it("concurrent daily checks create one run and one recipient row; other members are not opted in", async () => {
    const { env, db, activate, sent } = await setup(); const generation = await activate();
    await Promise.all([checkSiteAlert({ siteId: "s", generation }, env), checkSiteAlert({ siteId: "s", generation }, env)]);
    expect(db.prepare("SELECT count(*) AS n FROM site_alert_runs").all()).toEqual([{ n: 1 }]);
    expect(db.prepare("SELECT user_id FROM site_alert_mail_outbox").all()).toEqual([{ user_id: "owner" }]); expect(sent).toHaveLength(1);
  });
  it("conversions use their count baseline and missing history waits", async () => {
    const { env, status, save, db } = await setup(); const value = await status();
    expect((await save(value, { settings: { ...value.policy, enabled: true, metric: "conversions", minimumAverage: 10 } })).status).toBe(200);
    await checkSiteAlert({ siteId: "s", generation: (await status()).generation! }, env);
    expect(JSON.parse(String(db.prepare("SELECT evaluation_json FROM site_alert_runs").all()[0]!.evaluation_json))).toMatchObject({ result: "low", baselineSum: 70, target: [1, 1] });
  });
  it("configuration changes during the final batch roll back run and all outbox effects", async () => {
    const { env, d1, db, activate } = await setup(); const generation = await activate(), batch = d1.batch.bind(d1);
    vi.spyOn(d1, "batch").mockImplementation(async (statements) => { db.exec("UPDATE site_alert_settings SET generation='replacement'"); return batch(statements); });
    await expect(checkSiteAlert({ siteId: "s", generation }, env)).rejects.toThrow(/^site_alert_check_failed$/);
    expect(db.prepare("SELECT count(*) AS n FROM site_alert_runs").all()).toEqual([{ n: 0 }]);
  });
  it("no check before 09 KST and disabled site never generates deliveries", async () => {
    const { env, db, activate } = await setup(); const generation = await activate(); vi.mocked(Date.now).mockReturnValue(NOW - 1);
    await checkSiteAlert({ siteId: "s", generation }, env); expect(db.prepare("SELECT count(*) AS n FROM site_alert_runs").all()).toEqual([{ n: 0 }]);
    vi.mocked(Date.now).mockReturnValue(NOW); db.exec("UPDATE sites SET deleted_at=1"); await checkSiteAlert({ siteId: "s", generation }, env);
    expect(db.prepare("SELECT count(*) AS n FROM site_alert_mail_outbox").all()).toEqual([{ n: 0 }]);
  });
});

describe("bounded durable alert mail", () => {
  it.each(["demote", "rejoin", "phone", "email"])("%s then restoration never reactivates an old subscription or queued delivery", async (change) => {
    const { env, db, status, save, fetch, stage } = await setup(); const id = await stage(), before = await status();
    db.prepare("UPDATE site_alert_recipients SET last_attempt_at=?,last_delivery_id='previous'").run(NOW - 1000);
    if (change === "demote") { db.exec("UPDATE members SET role='viewer' WHERE user_id='owner'"); db.exec("UPDATE members SET role='owner' WHERE user_id='owner'"); }
    if (change === "rejoin") { db.exec("DELETE FROM members WHERE user_id='owner'"); db.exec("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES('w','owner','owner',1)"); }
    if (change === "phone") { db.exec("UPDATE users SET phone_verified_at=NULL WHERE id='owner'"); db.exec("UPDATE users SET phone_verified_at=1 WHERE id='owner'"); }
    if (change === "email") { db.exec("UPDATE users SET email='changed@team.test' WHERE id='owner'"); db.exec("UPDATE users SET email='owner@team.test' WHERE id='owner'"); }
    const after = await status(); expect(after.subscribed).toBe(false); expect(after.subscriptionGeneration).not.toBe(before.subscriptionGeneration); expect(after.cooldownUntil).toBe(NOW - 1000 + 7 * 86_400_000);
    expect((await save(after)).status).toBe(200); expect((await status()).subscribed).toBe(true);
    await sendSiteAlert({ id }, env); expect(fetch).not.toHaveBeenCalled();
    expect(db.prepare("SELECT status FROM site_alert_mail_outbox").all()).toEqual([{ status: "cancelled" }]);
    expect(db.prepare("SELECT last_attempt_at,last_delivery_id FROM site_alert_recipients").all()).toEqual([{ last_attempt_at: NOW - 1000, last_delivery_id: "previous" }]);
  });
  it("a demoted and rejoined recipient cannot replay an ambiguous old-generation attempt", async () => {
    const { env, db, status, save, fetch, stage } = await setup(); const id = await stage(); fetch.mockRejectedValueOnce(new Error("lost")); await expect(sendSiteAlert({ id }, env)).rejects.toThrow();
    db.exec("DELETE FROM members WHERE user_id='owner'"); db.exec("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES('w','owner','owner',1)"); expect((await save(await status())).status).toBe(200);
    vi.mocked(Date.now).mockReturnValue(NOW + 900_000); await sendSiteAlert({ id }, env); expect(fetch).toHaveBeenCalledOnce();
    expect(db.prepare("SELECT status,payload_enc FROM site_alert_mail_outbox").all()).toEqual([{ status: "unknown", payload_enc: null }]);
    expect(db.prepare("SELECT last_attempt_at FROM site_alert_recipients").all()).toEqual([{ last_attempt_at: NOW }]);
  });
  it("valid owner/editor changes and another workspace's membership preserve the subscription", async () => {
    const { db, stage, status } = await setup(); await stage(); const before = await status();
    db.exec("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES('foreign','owner','editor',1)");
    db.exec("UPDATE members SET role='editor' WHERE workspace_id='w' AND user_id='owner'"); db.exec("DELETE FROM members WHERE workspace_id='foreign' AND user_id='owner'");
    expect(await status()).toMatchObject({ subscribed: true, subscriptionGeneration: before.subscriptionGeneration });
  });
  it.each(["token", "provider", "sender", "reserved_subdomain"])("missing or invalid %s configuration blocks with zero provider requests", async (missing) => {
    const { env, db, fetch, stage } = await setup(); const id = await stage();
    if (missing === "token") delete env.TOKEN_ENC_KEY;
    if (missing === "provider") delete env.RESEND_API_KEY;
    if (missing === "sender") delete env.EMAIL_FROM;
    if (missing === "reserved_subdomain") env.EMAIL_FROM = "hello@mail.example.com";
    await sendSiteAlert({ id }, env); expect(fetch).not.toHaveBeenCalled();
    expect(db.prepare("SELECT status,payload_enc,first_attempt_at FROM site_alert_mail_outbox").all()).toEqual([{ status: "blocked", payload_enc: null, first_attempt_at: null }]);
  });
  it("missing configuration and example senders remain blocked without HTTP/payload/attempt", async () => {
    const { stage, env, db, fetch } = await setup(false); const id = await stage(); await sendSiteAlert({ id }, env);
    env.RESEND_API_KEY = "fake"; env.EMAIL_FROM = "no-reply@example.com"; vi.mocked(Date.now).mockReturnValue(NOW + 3_600_000); await sendSiteAlert({ id }, env);
    expect(fetch).not.toHaveBeenCalled(); expect(db.prepare("SELECT status,payload_enc,first_attempt_at FROM site_alert_mail_outbox").all()).toEqual([{ status: "blocked", payload_enc: null, first_attempt_at: null }]);
  });
  it("late recovery cancels before HTTP and consumes no cooldown", async () => {
    const { env, db, fetch, stage } = await setup(); const id = await stage(); db.exec("UPDATE site_daily_stats SET pageviews=100 WHERE day>='2026-11-08'");
    await sendSiteAlert({ id }, env); expect(fetch).not.toHaveBeenCalled();
    expect(db.prepare("SELECT status,error_code,first_attempt_at FROM site_alert_mail_outbox").all()).toEqual([{ status: "cancelled", error_code: "recovered", first_attempt_at: null }]);
    expect(db.prepare("SELECT last_attempt_at FROM site_alert_recipients").all()).toEqual([{ last_attempt_at: null }]);
  });
  it("recovery exactly at claim also cancels and undoes only its unsent intent", async () => {
    const { env, d1, db, fetch, stage } = await setup(); const id = await stage(), batch = d1.batch.bind(d1); let once = false;
    vi.spyOn(d1, "batch").mockImplementation(async (statements) => { if (!once) { once = true; db.exec("UPDATE site_daily_stats SET pageviews=100 WHERE day>='2026-11-08'"); } return batch(statements); });
    await sendSiteAlert({ id }, env); expect(fetch).not.toHaveBeenCalled();
    expect(db.prepare("SELECT status,first_attempt_at FROM site_alert_mail_outbox").all()).toEqual([{ status: "cancelled", first_attempt_at: null }]);
    expect(db.prepare("SELECT last_attempt_at,last_delivery_id FROM site_alert_recipients").all()).toEqual([{ last_attempt_at: null, last_delivery_id: null }]);
  });
  it("response loss retries with the same frozen body/key and scrubs ciphertext after acceptance", async () => {
    const { env, db, fetch, stage } = await setup(); const id = await stage(); fetch.mockRejectedValueOnce(new Error("PRIVATE response lost"));
    await expect(sendSiteAlert({ id }, env)).rejects.toThrow(/^site_alert_mail_failed$/);
    expect(String(db.prepare("SELECT payload_enc FROM site_alert_mail_outbox").all()[0]!.payload_enc)).not.toContain("owner@team.test");
    vi.mocked(Date.now).mockReturnValue(NOW + 15 * 60_000); await sendSiteAlert({ id }, env);
    const attempts = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(attempts).toHaveLength(2); expect(attempts[0]![1].body).toBe(attempts[1]![1].body);
    expect(new Headers(attempts[1]![1].headers).get("Idempotency-Key")).toBe(`site-alert/${id}`);
    expect(db.prepare("SELECT status,payload_enc,provider_id FROM site_alert_mail_outbox").all()).toEqual([{ status: "sent", payload_enc: null, provider_id: "provider-id" }]);
    expect(db.prepare("SELECT last_attempt_at FROM site_alert_recipients").all()).toEqual([{ last_attempt_at: NOW }]);
  });
  it("provider rate errors leave a durable retry and never log its private response", async () => {
    const { env, db, fetch, stage } = await setup(); const id = await stage(); fetch.mockResolvedValueOnce(new Response("PRIVATE provider address owner@team.test", { status: 429 }));
    await expect(sendSiteAlert({ id }, env)).rejects.toThrow(/^site_alert_mail_failed$/);
    expect(db.prepare("SELECT status,next_attempt_at FROM site_alert_mail_outbox").all()).toEqual([{ status: "failed", next_attempt_at: NOW + 900_000 }]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/PRIVATE|owner@team/); vi.mocked(Date.now).mockReturnValue(NOW + 900_000); await sendSiteAlert({ id }, env); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["site", "role", "email", "subscription", "configuration"])("%s change cancels an unattempted delivery without retargeting", async (change) => {
    const { env, db, fetch, stage } = await setup(); const id = await stage();
    if (change === "site") db.exec("UPDATE sites SET deleted_at=1");
    if (change === "role") db.exec("UPDATE members SET role='viewer' WHERE user_id='owner'");
    if (change === "email") db.exec("UPDATE users SET email='replacement@team.test' WHERE id='owner'");
    if (change === "subscription") db.exec("UPDATE site_alert_recipients SET generation='new',active=0");
    if (change === "configuration") db.exec("UPDATE site_alert_settings SET generation='new'");
    await sendSiteAlert({ id }, env); expect(fetch).not.toHaveBeenCalled();
    expect(db.prepare("SELECT status,payload_enc FROM site_alert_mail_outbox").all()).toEqual([{ status: "cancelled", payload_enc: null }]);
  });
  it("ambiguous delivery is never retried after the 24-hour provider window", async () => {
    const { env, db, fetch, stage } = await setup(); const id = await stage(); fetch.mockRejectedValueOnce(new Error("lost"));
    await expect(sendSiteAlert({ id }, env)).rejects.toThrow(); vi.mocked(Date.now).mockReturnValue(NOW + 86_400_000 - 60_000);
    await sendSiteAlert({ id }, env); expect(fetch).toHaveBeenCalledOnce(); expect(db.prepare("SELECT status,payload_enc FROM site_alert_mail_outbox").all()).toEqual([{ status: "unknown", payload_enc: null }]);
  });
  it("generation off/on toggles and resubscription cannot reset a booked cooldown", async () => {
    const { env, db, fetch, stage, status, save } = await setup(); const id = await stage(); await sendSiteAlert({ id }, env);
    let current = await status(); expect((await save(current, { settings: { ...current.policy, enabled: false }, subscribed: false })).status).toBe(200);
    current = await status(); expect((await save(current)).status).toBe(200);
    current = await status(); await checkSiteAlert({ siteId: "s", generation: current.generation }, env);
    const second = db.prepare("SELECT id FROM site_alert_mail_outbox WHERE id<>?").all(id)[0]!.id;
    await sendSiteAlert({ id: second }, env); expect(fetch).toHaveBeenCalledOnce();
    expect(db.prepare("SELECT last_attempt_at FROM site_alert_recipients").all()).toEqual([{ last_attempt_at: NOW }]);
  });
  it("concurrent delivery workers claim one HTTP and a stale closer cannot erase it", async () => {
    const { env, db, fetch, stage } = await setup(); const id = await stage(); let finish!: (value: Response) => void;
    fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = sendSiteAlert({ id }, env); await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await sendSiteAlert({ id }, env); expect(fetch).toHaveBeenCalledOnce(); finish(Response.json({ id: "accepted" })); await first;
    expect(db.prepare("SELECT status,provider_id FROM site_alert_mail_outbox").all()).toEqual([{ status: "sent", provider_id: "accepted" }]);
  });
  it("queue failure leaves the outbox durable for bounded maintenance and actual Worker routing", async () => {
    const { env, db, sendBatch, sent, activate } = await setup(); const generation = await activate(); sendBatch.mockRejectedValueOnce(new Error("queue failed"));
    await expect(checkSiteAlert({ siteId: "s", generation }, env)).rejects.toThrow();
    expect(db.prepare("SELECT count(*) AS n FROM site_alert_mail_outbox").all()).toEqual([{ n: 1 }]);
    await maintainSiteAlerts(env); const message = sent.find((m) => m.type === "send_site_alert")!; const ack = vi.fn(), retry = vi.fn();
    await worker.queue({ queue: "avocado-pipeline", messages: [{ body: message, ack, retry }] } as unknown as MessageBatch<PipelineMessage>, env);
    expect(ack).toHaveBeenCalledOnce(); expect(retry).not.toHaveBeenCalled();
  });
  it("role removal while the final aggregate query runs is caught by the last authority read", async () => {
    const { env, d1, db, fetch, stage } = await setup(); const id = await stage(), prepare = d1.prepare.bind(d1); let stats = 0;
    vi.spyOn(d1, "prepare").mockImplementation((sql) => {
      const statement = prepare(sql);
      if (!sql.startsWith("SELECT day,sum")) return statement;
      const bind = statement.bind.bind(statement);
      statement.bind = (...params) => { const bound = bind(...params), all = bound.all.bind(bound); bound.all = (async () => { const result = await all(); if (++stats === 2) db.exec("UPDATE members SET role='viewer' WHERE user_id='owner'"); return result; }) as typeof bound.all; return bound; };
      return statement;
    });
    await sendSiteAlert({ id }, env); expect(fetch).not.toHaveBeenCalled();
    expect(db.prepare("SELECT status,first_attempt_at FROM site_alert_mail_outbox").all()).toEqual([{ status: "cancelled", first_attempt_at: null }]);
  });
  it.each(["email", "role", "provider"])("%s change after response loss closes unknown without new HTTP", async (change) => {
    const { env, db, fetch, stage } = await setup(); const id = await stage(); fetch.mockRejectedValueOnce(new Error("private response"));
    await expect(sendSiteAlert({ id }, env)).rejects.toThrow(); vi.mocked(Date.now).mockReturnValue(NOW + 900_000);
    if (change === "email") db.exec("UPDATE users SET email='new@team.test' WHERE id='owner'");
    if (change === "role") db.exec("DELETE FROM members WHERE user_id='owner'");
    if (change === "provider") env.RESEND_API_KEY = "rotated-provider";
    await sendSiteAlert({ id }, env); expect(fetch).toHaveBeenCalledOnce();
    expect(db.prepare("SELECT status,payload_enc FROM site_alert_mail_outbox").all()).toEqual([{ status: "unknown", payload_enc: null }]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/private response|owner@team|rotated-provider/);
  });
  it("a stale context closer cannot overwrite another worker's accepted delivery", async () => {
    const { env, d1, db, fetch, stage } = await setup(); const id = await stage(), prepare = d1.prepare.bind(d1); let release!: () => void, entered!: () => void;
    const paused = new Promise<void>((resolve) => { entered = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; }); let once = false;
    vi.spyOn(d1, "prepare").mockImplementation((sql) => {
      const statement = prepare(sql); if (!sql.startsWith("SELECT s.name AS site_name") || once) return statement;
      once = true; const bind = statement.bind.bind(statement); statement.bind = (...params) => { const bound = bind(...params); bound.first = async () => { entered(); await gate; return null; }; return bound; }; return statement;
    });
    const stale = sendSiteAlert({ id }, env); await paused; await sendSiteAlert({ id }, env); release(); await stale;
    expect(fetch).toHaveBeenCalledOnce(); expect(db.prepare("SELECT status,provider_id FROM site_alert_mail_outbox").all()).toEqual([{ status: "sent", provider_id: "provider-id" }]);
  });
  it("hard site deletion retains uncertain evidence, scrubs the payload and never retries", async () => {
    const { env, db, fetch, stage } = await setup(); const id = await stage(); fetch.mockRejectedValueOnce(new Error("lost"));
    await expect(sendSiteAlert({ id }, env)).rejects.toThrow(); db.exec("DELETE FROM sites WHERE id='s'");
    expect(db.prepare("SELECT count(*) AS n FROM site_alert_mail_outbox").all()).toEqual([{ n: 1 }]); await maintainSiteAlerts(env);
    expect(db.prepare("SELECT status,payload_enc FROM site_alert_mail_outbox").all()).toEqual([{ status: "unknown", payload_enc: null }]);
    await sendSiteAlert({ id }, env); expect(fetch).toHaveBeenCalledOnce(); expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("retention purges only a bounded 100 receipts per cleanup and preserves recent evidence", async () => {
    const { env, db, stage } = await setup(); await stage();
    const columns = db.prepare("PRAGMA table_info(site_alert_mail_outbox)").all().map((r) => String(r.name)), original = db.prepare("SELECT * FROM site_alert_mail_outbox").all()[0]!;
    for (let i = 0; i < 101; i++) { const row = { ...original, id: `old-${i}`, run_id: `old-run-${i}`, status: "sent", created_at: NOW - 31 * 86_400_000, payload_enc: null }; db.prepare(`INSERT INTO site_alert_mail_outbox(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map((c) => row[c as keyof typeof row])); }
    await maintainSiteAlerts(env); expect(db.prepare("SELECT count(*) AS n FROM site_alert_mail_outbox").all()).toEqual([{ n: 2 }]);
    await maintainSiteAlerts(env); expect(db.prepare("SELECT count(*) AS n FROM site_alert_mail_outbox").all()).toEqual([{ n: 1 }]);
  });
  it("maintenance invalidates at most 100 stale recipients per call without resetting cooldowns", async () => {
    const { env, db, activate } = await setup(); await activate();
    for (let i = 0; i < 101; i++) {
      db.prepare("INSERT INTO users(id,email,password_hash,name,phone_verified_at,created_at) VALUES(?,?,'','QA',1,1)").run(`gone-${i}`, `gone-${i}@team.test`);
      db.prepare("INSERT INTO site_alert_recipients(site_id,user_id,generation,active,last_attempt_at,created_at,updated_at) VALUES('s',?,'old',1,?,1,1)").run(`gone-${i}`, NOW);
    }
    await maintainSiteAlerts(env); expect(db.prepare("SELECT count(*) AS n FROM site_alert_recipients WHERE user_id LIKE 'gone-%' AND active=1").all()).toEqual([{ n: 1 }]);
    await maintainSiteAlerts(env); expect(db.prepare("SELECT count(*) AS n FROM site_alert_recipients WHERE user_id LIKE 'gone-%' AND active=0 AND generation<>'old' AND last_attempt_at=?").all(NOW)).toEqual([{ n: 101 }]);
  });
  it("bounded discovery queues 20 sites/50 recipients, continues backlog and recovers enqueue failure next period", async () => {
    const { env, db, sent, sendBatch, stage } = await setup(); await stage(); sent.length = 0;
    for (let i = 0; i < 21; i++) { db.prepare("INSERT INTO sites(id,workspace_id,site_key,name,allowed_domains,created_at) VALUES(?,'w',?,'QA','[]',1)").run(`site-${i}`, `key-${i}`); db.prepare("INSERT INTO site_alert_settings SELECT ?,generation,enabled,metric,ratio_percent,minimum_average,confirmation_days,?,NULL,NULL,NULL,created_at,updated_at FROM site_alert_settings WHERE site_id='s'").run(`site-${i}`, NOW); }
    const columns = db.prepare("PRAGMA table_info(site_alert_mail_outbox)").all().map((r) => String(r.name)), original = db.prepare("SELECT * FROM site_alert_mail_outbox").all()[0]!;
    for (let i = 0; i < 59; i++) { const row = { ...original, id: `pending-${i}`, run_id: `pending-run-${i}` }; db.prepare(`INSERT INTO site_alert_mail_outbox(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map((c) => row[c as keyof typeof row])); }
    sendBatch.mockRejectedValueOnce(new Error("private enqueue error")); await expect(maintainSiteAlerts(env)).rejects.toThrow(/^site_alert_maintenance_failed$/);
    expect(sent).toHaveLength(0); vi.mocked(Date.now).mockReturnValue(NOW + 900_000); await maintainSiteAlerts(env);
    expect(sent.filter((m) => m.type === "check_site_alert")).toHaveLength(ALERT_SITE_BATCH); expect(sent.filter((m) => m.type === "send_site_alert")).toHaveLength(ALERT_MAIL_BATCH);
    expect(sent.filter((m) => m.type === "site_alert_maintenance")).toHaveLength(1);
    sent.length = 0; await maintainSiteAlerts(env); expect(sent.filter((m) => m.type === "send_site_alert")).toHaveLength(10); expect(sent.every((m) => !JSON.stringify(m).includes("@"))).toBe(true);
  });
  it("worst normal detector, mail and combined cleanup keep statement/subrequest budgets below 50", async () => {
    const { env, d1, db, activate, fetch } = await setup(); const generation = await activate(), counted = meter(d1); env.DB = counted.db;
    await checkSiteAlert({ siteId: "s", generation }, env); expect(counted.value()).toEqual({ queries: 7, maxParams: 11 });
    const id = String(db.prepare("SELECT id FROM site_alert_mail_outbox").all()[0]!.id); counted.reset(); await sendSiteAlert({ id }, env);
    expect(counted.value().queries).toBe(8); expect(counted.value().maxParams).toBeLessThanOrEqual(100); expect(fetch).toHaveBeenCalledOnce();
    counted.reset(); const ack = vi.fn(), retry = vi.fn(); await worker.queue({ queue: "avocado-pipeline", messages: [{ body: { type: "cleanup_google_sheets", payload: {} }, ack, retry }] } as unknown as MessageBatch<PipelineMessage>, env);
    expect(ack).toHaveBeenCalledOnce(); expect(retry).not.toHaveBeenCalled(); expect(counted.value().queries).toBe(16); // Import receipt cleanup adds one bounded SQL.
     expect(counted.value().maxParams).toBeLessThanOrEqual(100);
  });
});
