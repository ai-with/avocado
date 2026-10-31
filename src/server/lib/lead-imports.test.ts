import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv, Auth } from "../types";
import { getDb } from "../db";
import { createSqliteD1 } from "../test/sqlite-d1";
import { leadImportRoutes } from "../routes/leads/import";
import { ApiError, errorBody } from "./errors";
import { cleanupLeadImports } from "./lead-imports";
import { sha256Hex } from "./ids";
import worker from "../index";
import { IMPORT_BODY_BYTES, IMPORT_TTL_MS, type ImportContext, type ImportJob, type ImportReceipt, type ImportRow } from "../../shared/lead-imports";

const NOW = Date.parse("2026-11-01T00:00:00Z");
const close: (() => void)[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("no external transport"); })); });
afterEach(() => { close.splice(0).forEach((fn) => fn()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup() {
  const base = await createSqliteD1(); close.push(base.close); const { db, d1 } = base;
  db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w','LOCAL',1),('other','OTHER',1)");
  db.exec("INSERT INTO users(id,email,password_hash,name,phone_verified_at,created_at) VALUES('u','local@example.invalid','','LOCAL',1,1)");
  db.exec("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES('w','u','owner',1),('other','u','owner',1)");
  db.prepare("INSERT INTO sessions(id,user_id,current_workspace_id,expires_at,created_at) VALUES('session','u','w',?,1),('different-session','u','w',?,1)").run(NOW + 2 * IMPORT_TTL_MS, NOW + 2 * IMPORT_TTL_MS);
  const env = { DB: d1, TOKEN_ENC_KEY: "local-import-test-key", APP_URL: "https://app.test" } as Env;
  let auth: Auth = { user: { id: "u", email: "local@example.invalid", name: "LOCAL" }, workspace: { id: "w", name: "LOCAL", plan: "starter", onboardedAt: 1 }, role: "owner", sessionId: "session", phoneVerified: true, phone: null };
  const app = new Hono<AppEnv>(); app.use("*", async (c, next) => { c.set("auth", auth); c.set("db", getDb(c.env.DB)); await next(); }); app.route("/leads", leadImportRoutes);
  app.onError((error, c) => error instanceof ApiError ? c.json(errorBody(error.code, error.message, error.fields), error.status) : c.json({ error: { code: "unexpected" } }, 500));
  const context = async () => await (await app.request("/leads/import/context", {}, env)).json() as ImportContext;
  const ctx = await context();
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => app.request("/leads/import" + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", Origin: env.APP_URL, "X-CSRF-Token": ctx.csrfToken, ...headers }, body: JSON.stringify(body) }, env);
  const createBody = (totalRows: number) => ({ requestId: crypto.randomUUID(), requestedAt: NOW, fingerprint: "a".repeat(64), totalRows, consentConfirmed: true as const });
  const create = async (totalRows: number) => {
    const input = createBody(totalRows), response = await request("/jobs", input); expect(response.status).toBe(200);
    return { input, job: await response.json() as ImportJob };
  };
  const applyBody = (job: ImportJob, rows: ImportRow[], chunkNo = job.nextChunk) => ({ generation: job.generation, chunkNo, rows, consentConfirmed: true });
  const apply = (job: ImportJob, rows: ImportRow[], chunkNo?: number) => request(`/jobs/${job.id}/chunks`, applyBody(job, rows, chunkNo));
  const seed = (id: string, email: string, deleted = false) => db.prepare("INSERT INTO leads(id,workspace_id,email,name,phone,answers,unsubscribe_token,first_source,last_source,created_at,deleted_at) VALUES(?,'w',?,'BEFORE','OLD-PHONE','{}',?,'{}','{}',?,?)").run(id, email, "token-" + id, NOW - 10_000, deleted ? NOW - 1000 : null);
  return { ...base, env, app, ctx, request, create, createBody, apply, applyBody, seed, setAuth: (patch: Partial<Auth>) => { auth = { ...auth, ...patch }; } };
}
function meter(base: D1Database) {
  let stats = { physical: 0, calls: 0, maxBind: 0, maxBindBytes: 0, maxSqlBytes: 0, maxResultBytes: 0 };
  const observe = (value: unknown) => { stats.maxResultBytes = Math.max(stats.maxResultBytes, new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength); return value; };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, { get(target, key) {
    if (key === "bind") return (...args: unknown[]) => { stats.maxBind = Math.max(stats.maxBind, args.length); stats.maxBindBytes = Math.max(stats.maxBindBytes, ...args.filter((arg) => typeof arg === "string").map((arg) => new TextEncoder().encode(arg as string).byteLength)); return wrap(target.bind(...args)); };
    if (["all", "run", "first", "raw"].includes(String(key))) return async (...args: unknown[]) => { stats.physical++; stats.calls++; return observe(await Reflect.get(target, key).apply(target, args)); };
    return Reflect.get(target, key);
  } });
  return { db: { ...base, prepare: (sql: string) => { stats.maxSqlBytes = Math.max(stats.maxSqlBytes, new TextEncoder().encode(sql).byteLength); return wrap(base.prepare(sql)); }, batch: async (rows: D1PreparedStatement[]) => { stats.physical += rows.length; stats.calls++; return observe(await base.batch(rows)); } } as D1Database,
    value: () => ({ ...stats }), reset: () => { stats = { physical: 0, calls: 0, maxBind: 0, maxBindBytes: 0, maxSqlBytes: 0, maxResultBytes: 0 }; } };
}
const rows = (offset: number, count = 100) => Array.from({ length: count }, (_, i) => ({ email: `local-${offset + i}@example.invalid`, name: "LOCAL" }));

describe("lead import atomic receipts and boundaries", () => {
  it("consent is required before import authority IO, even for a forged disabled-button request", async () => {
    const s = await setup(), m = meter(s.d1); s.env.DB = m.db; s.setAuth({ role: "viewer" });
    for (const consentConfirmed of [false, undefined, "true"]) {
      expect((await s.request("/jobs", { ...s.createBody(1), consentConfirmed })).status).toBe(400);
      expect((await s.request("/jobs/unknown/chunks", { generation: "x", chunkNo: 0, rows: rows(0, 1), consentConfirmed })).status).toBe(400);
    }
    expect(m.value().physical).toBe(0);
  });
  it("bounds the actual stream, field lengths and row count with zero import IO", async () => {
    const s = await setup(), m = meter(s.d1); s.env.DB = m.db;
    expect((await s.request("/jobs/unknown/chunks", { generation: "x", chunkNo: 0, consentConfirmed: true, rows: [{ email: "x".repeat(IMPORT_BODY_BYTES) }] }, { "Content-Length": "1" })).status).toBe(413);
    expect((await s.request("/jobs/unknown/chunks", { generation: "x", chunkNo: 0, consentConfirmed: true, rows: [{ email: "ok@example.invalid", name: "x".repeat(101) }] })).status).toBe(400);
    expect((await s.request("/jobs/unknown/chunks", { generation: "x", chunkNo: 0, consentConfirmed: true, rows: rows(0, 101) })).status).toBe(400);
    expect(m.value().physical).toBe(0);
  });
  it("creation is idempotent and cannot retarget another payload/workspace/session", async () => {
    const s = await setup(), input = s.createBody(1);
    const responses = await Promise.all([s.request("/jobs", input), s.request("/jobs", input)]);
    expect(await responses[0]!.json()).toEqual(await responses[1]!.json());
    expect((await s.request("/jobs", { ...input, totalRows: 2 })).status).toBe(409);
    expect((await s.request("/jobs", { ...input, fingerprint: "b".repeat(64) })).status).toBe(409);
    s.setAuth({ sessionId: "different-session" }); expect((await s.request(`/jobs/${input.requestId}`)).status).toBe(404);
    expect(s.db.prepare("SELECT count(*) AS n FROM lead_import_jobs").all()).toEqual([{ n: 1 }]);
  });
  it("preserves merge order, blank fields, consent OR, unsubscribes and bounce generation", async () => {
    const s = await setup(); s.seed("existing", "same@example.invalid");
    s.db.exec("UPDATE leads SET marketing_opt_in=1,unsubscribed_at=3,bounced_at=4,answers='{\"keep\":\"ANSWER\"}' WHERE id='existing'");
    const { job } = await s.create(3);
    const result = await s.apply(job, [{ email: " SAME@example.invalid ", name: "FIRST", company: "COMPANY", marketing_opt_in: "no" }, { email: "same@example.invalid", name: "LAST", phone: "", company: "" }, { email: "invalid" }]);
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ imported: 2, invalid: [2], skipped: [], job: { status: "completed", processed: 3 } });
    expect(s.db.prepare("SELECT id,name,company,phone,marketing_opt_in,unsubscribed_at,bounced_at,answers,unsubscribe_token FROM leads").all()).toEqual([{ id: "existing", name: "LAST", company: "COMPANY", phone: "OLD-PHONE", marketing_opt_in: 1, unsubscribed_at: 3, bounced_at: 4, answers: '{"keep":"ANSWER"}', unsubscribe_token: "token-existing" }]);
    expect(s.db.prepare("SELECT count(*) AS n FROM lead_sources").all()).toEqual([{ n: 2 }]);
    expect(JSON.stringify(s.db.prepare("SELECT * FROM lead_import_jobs UNION ALL SELECT * FROM lead_import_jobs WHERE 0").all())).not.toContain("same@example.invalid");
    expect(JSON.stringify(s.db.prepare("SELECT * FROM lead_import_chunks").all())).not.toMatch(/same@example|ANSWER|COMPANY/);
  });

  it("preserves quoted CSV line breaks and trims peripheral tab whitespace", async () => {
    const s = await setup(), { job } = await s.create(1);
    const result = await s.apply(job, [{ email: " multiline@example.invalid ", name: "FIRST\nSECOND", company: "R&D\r\nQA", phone: "\tTEST-PHONE\t" }]);
    expect(result.status).toBe(200);
    expect(s.db.prepare("SELECT name,company,phone FROM leads").all()).toEqual([{ name: "FIRST\nSECOND", company: "R&D\r\nQA", phone: "TEST-PHONE" }]);
  });
  it("same chunk concurrency and response replay return the exact stored receipt", async () => {
    const s = await setup(), { job } = await s.create(100), input = rows(0);
    const responses = await Promise.all([s.apply(job, input), s.apply(job, input)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const result = await responses[0]!.json(); expect(await responses[1]!.json()).toEqual(result);
    expect(await (await s.apply(job, input)).json()).toEqual(result);
    expect((await s.apply(job, [{ ...input[0]!, name: "DIFFERENT" }, ...input.slice(1)])).status).toBe(409);
    expect(s.db.prepare("SELECT (SELECT count(*) FROM leads) AS leads,(SELECT count(*) FROM lead_sources) AS sources,(SELECT count(*) FROM events) AS events").all()).toEqual([{ leads: 100, sources: 100, events: 1 }]);
  });
  it("a middle SQL failure rolls back contacts, clocks, receipt, progress and event together", async () => {
    const s = await setup(), { job } = await s.create(1);
    s.db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON lead_sources BEGIN SELECT RAISE(ABORT,'PRIVATE-FAILURE'); END");
    const response = await s.apply(job, rows(0, 1)); expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/PRIVATE|local-0@example/);
    expect(s.db.prepare("SELECT (SELECT count(*) FROM leads) AS leads,(SELECT count(*) FROM lead_import_chunks) AS chunks,(SELECT count(*) FROM events) AS events").all()).toEqual([{ leads: 0, chunks: 0, events: 0 }]);
    expect(s.db.prepare("SELECT processed_rows,privacy_epoch FROM lead_import_jobs").all()).toEqual([{ processed_rows: 0, privacy_epoch: 0 }]);
    expect(s.db.prepare("SELECT revision FROM lead_import_clocks WHERE workspace_id='w'").all()).toEqual([{ revision: 0 }]);
    s.db.exec("DROP TRIGGER fail_import"); expect((await s.apply(job, rows(0, 1))).status).toBe(200);
  });
  it("a lost commit response resolves the receipt without executing another write batch", async () => {
    const s = await setup(), { job } = await s.create(1), batch = s.d1.batch.bind(s.d1); let calls = 0;
    vi.spyOn(s.d1, "batch").mockImplementation(async (statements) => { calls++; await batch(statements); throw new Error("PRIVATE commit response lost"); });
    const response = await s.apply(job, rows(0, 1)); expect(response.status).toBe(200); expect(calls).toBe(1);
    expect(s.db.prepare("SELECT count(*) AS n FROM lead_sources").all()).toEqual([{ n: 1 }]);
  });
  it("concurrent different chunk contents commit one winner and reject the other", async () => {
    const s = await setup(), { job } = await s.create(1);
    const responses = await Promise.all([s.apply(job, [{ email: "same@example.invalid", name: "ONE" }]), s.apply(job, [{ email: "same@example.invalid", name: "TWO" }])]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(s.db.prepare("SELECT count(*) AS n FROM lead_sources").all()).toEqual([{ n: 1 }]);
  });
  it("tombstone purge rollback preserves old private children and its original epoch", async () => {
    const s = await setup(); s.seed("old", "old@example.invalid", true);
    s.db.exec("INSERT INTO lead_sources(id,lead_id,type,at) VALUES('private-old-source','old','manual',1)");
    const { job } = await s.create(1);
    s.db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON lead_sources BEGIN SELECT RAISE(ABORT,'failure'); END");
    expect((await s.apply(job, [{ email: "old@example.invalid" }])).status).toBe(503);
    expect(s.db.prepare("SELECT id,phone FROM leads").all()).toEqual([{ id: "old", phone: "OLD-PHONE" }]);
    expect(s.db.prepare("SELECT id FROM lead_sources").all()).toEqual([{ id: "private-old-source" }]);
    expect(s.db.prepare("SELECT privacy_epoch FROM lead_import_clocks WHERE workspace_id='w'").all()).toEqual([{ privacy_epoch: 0 }]);
    expect(s.db.prepare("SELECT count(*) AS n FROM lead_import_chunks").all()).toEqual([{ n: 0 }]);
  });
  it.each(["role", "workspace", "session", "phone", "cancel"])("%s change exactly before native batch leaves no contact effects", async (change) => {
    const s = await setup(), { job } = await s.create(1), batch = s.d1.batch.bind(s.d1); let once = false;
    vi.spyOn(s.d1, "batch").mockImplementation(async (statements) => {
      if (!once) { once = true;
        if (change === "role") s.db.exec("UPDATE members SET role='viewer' WHERE workspace_id='w'");
        if (change === "workspace") s.db.exec("UPDATE sessions SET current_workspace_id='other' WHERE id='session'");
        if (change === "session") s.db.exec("UPDATE sessions SET expires_at=1 WHERE id='session'");
        if (change === "phone") s.db.exec("UPDATE users SET phone_verified_at=NULL");
        if (change === "cancel") expect((await s.request(`/jobs/${job.id}/cancel`, { generation: job.generation })).status).toBe(200);
      } return batch(statements);
    });
    expect((await s.apply(job, rows(0, 1))).status).not.toBe(200);
    expect(s.db.prepare("SELECT count(*) AS n FROM leads").all()).toEqual([{ n: 0 }]);
    expect(s.db.prepare("SELECT count(*) AS n FROM lead_import_chunks").all()).toEqual([{ n: 0 }]);
  });
  it("own tombstone purge adopts only its own epoch; another job stays blocked", async () => {
    const s = await setup(); s.seed("old-a", "old-a@example.invalid", true); s.seed("old-b", "old-b@example.invalid", true);
    s.db.exec("INSERT INTO lead_sources(id,lead_id,type,at) VALUES('old-source','old-a','manual',1)");
    const a = await s.create(200), b = await s.create(1);
    const first = await s.apply(a.job, [{ email: "old-a@example.invalid", name: "FRESH" }, ...rows(0, 99)]); expect(first.status).toBe(200);
    const next = (await first.json() as ImportReceipt).job;
    expect((await s.apply(b.job, rows(999, 1))).status).toBe(409);
    const second = await s.apply(next, [{ email: "old-a@example.invalid", name: "OWN-SECOND" }, { email: "old-b@example.invalid" }, ...rows(100, 98)]); expect(second.status).toBe(200);
    expect(s.db.prepare("SELECT name,phone FROM leads WHERE email='old-a@example.invalid'").all()).toEqual([{ name: "OWN-SECOND", phone: null }]);
    expect(s.db.prepare("SELECT id FROM leads WHERE id IN ('old-a','old-b')").all()).toEqual([]);
    expect(s.db.prepare("SELECT id FROM lead_sources WHERE id='old-source'").all()).toEqual([]);
    expect(s.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("newer registrations are skipped by birth revision even with backdated timestamps", async () => {
    const s = await setup(), { job } = await s.create(1); s.seed("new", "new@example.invalid");
    const response = await s.apply(job, [{ email: "new@example.invalid", name: "STALE" }]);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ imported: 0, skipped: [0], job: { skipped: 1 } });
    expect(s.db.prepare("SELECT name FROM leads WHERE id='new'").all()).toEqual([{ name: "BEFORE" }]);
  });
  it.each(["soft", "hard", "rejoin"])("external %s deletion cannot be resurrected by the old job", async (action) => {
    const s = await setup(); s.seed("old", "old@example.invalid"); const { job } = await s.create(1);
    if (action === "soft") s.db.exec("UPDATE leads SET deleted_at=1 WHERE id='old'");
    else s.db.exec("DELETE FROM leads WHERE id='old'");
    if (action === "rejoin") s.seed("fresh", "old@example.invalid");
    expect((await s.apply(job, [{ email: "old@example.invalid", name: "STALE" }])).status).toBe(409);
    expect(await (await s.request(`/jobs/${job.id}`)).json()).toMatchObject({ status: "blocked", processed: 0 });
    expect(s.db.prepare("SELECT name FROM leads WHERE id='fresh'").all()).toEqual(action === "rejoin" ? [{ name: "BEFORE" }] : []);
  });
  it("a later deletion/rejoin of an own imported lead blocks continuation, while other workspaces stay isolated", async () => {
    const s = await setup(), { job } = await s.create(101);
    const result = await (await s.apply(job, rows(0))).json() as ImportReceipt;
    s.db.exec("INSERT INTO leads(id,workspace_id,email,answers,unsubscribe_token,first_source,last_source,created_at) VALUES('other-lead','other','other@example.invalid','{}','other-token','{}','{}',1)");
    s.db.exec("DELETE FROM leads WHERE id='other-lead'");
    expect(await (await s.request(`/jobs/${job.id}`)).json()).toMatchObject({ status: "active" });
    s.db.exec("DELETE FROM leads WHERE email='local-0@example.invalid'"); s.seed("fresh", "local-0@example.invalid");
    expect((await s.apply(result.job, [{ email: "local-0@example.invalid", name: "STALE" }])).status).toBe(409);
    expect(s.db.prepare("SELECT name FROM leads WHERE id='fresh'").all()).toEqual([{ name: "BEFORE" }]);
  });
  it("expiration and bounded cleanup never let the original create/chunk request restart", async () => {
    const s = await setup(), { input, job } = await s.create(1); expect((await s.apply(job, rows(0, 1))).status).toBe(200);
    vi.mocked(Date.now).mockReturnValue(NOW + IMPORT_TTL_MS);
    expect((await s.apply(job, rows(0, 1))).status).toBe(410);
    await cleanupLeadImports(s.env);
    expect((await s.request("/jobs", input)).status).toBe(410);
    expect(s.db.prepare("SELECT count(*) AS n FROM lead_import_jobs").all()).toEqual([{ n: 0 }]);
    expect(s.db.prepare("SELECT count(*) AS n FROM lead_import_chunks").all()).toEqual([{ n: 0 }]);
    expect(s.db.prepare("SELECT count(*) AS n FROM lead_import_owned").all()).toEqual([{ n: 0 }]);
    expect(s.db.prepare("SELECT count(*) AS n FROM leads").all()).toEqual([{ n: 1 }]);
  });
  it("100 largest fields remain within request/bind/SQL/result bounds and physical SQL50", async () => {
    const s = await setup(), { job } = await s.create(100), m = meter(s.d1); s.env.DB = m.db;
    const input = rows(0).map((row) => ({ ...row, name: "한".repeat(100), company: "😀".repeat(50), phone: "1".repeat(30), marketing_opt_in: "yes" }));
    expect(new TextEncoder().encode(JSON.stringify(s.applyBody(job, input))).byteLength).toBeLessThan(IMPORT_BODY_BYTES);
    const response = await s.apply(job, input); expect(response.status).toBe(200);
    const stats = m.value(); expect(stats.physical).toBeLessThanOrEqual(50); expect(stats.calls).toBe(4); expect(stats.maxBind).toBeLessThanOrEqual(100); expect(stats.maxSqlBytes).toBeLessThan(100_000); expect(stats.maxBindBytes).toBeLessThan(512 * 1024); expect(stats.maxResultBytes).toBeLessThan(16 * 1024);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("set-based resurrection of 100 tombstones still submits only 25 physical SQL in 4 calls", async () => {
    const s = await setup(); for (let i = 0; i < 100; i++) s.seed("old-" + i, `local-${i}@example.invalid`, true);
    const { job } = await s.create(100), m = meter(s.d1); s.env.DB = m.db;
    expect((await s.apply(job, rows(0))).status).toBe(200);
    expect(m.value().physical).toBe(25); expect(m.value().calls).toBe(4); expect(m.value().maxBind).toBeLessThanOrEqual(100);
  });
  it("actual Worker routing and cookie auth keep the worst chunk below physical SQL50 including middleware", async () => {
    const s = await setup(); for (let i = 0; i < 100; i++) s.seed("old-" + i, `local-${i}@example.invalid`, true);
    const session = await sha256Hex("local-cookie-only");
    s.db.prepare("INSERT INTO sessions(id,user_id,current_workspace_id,expires_at,created_at) VALUES(?,'u','w',?,1)").run(session, NOW + IMPORT_TTL_MS);
    const m = meter(s.d1); s.env.DB = m.db;
    const call = (path: string, body?: unknown, csrf = "") => worker.fetch(new Request(s.env.APP_URL + "/api/leads/import" + path, { method: body === undefined ? "GET" : "POST", headers: { Cookie: "sid=local-cookie-only", Origin: s.env.APP_URL, "X-CSRF-Token": csrf, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), s.env, {} as ExecutionContext);
    const context = await (await call("/context")).json() as ImportContext;
    const job = await (await call("/jobs", s.createBody(100), context.csrfToken)).json() as ImportJob;
    m.reset(); const response = await call(`/jobs/${job.id}/chunks`, s.applyBody(job, rows(0)), context.csrfToken);
    expect(response.status).toBe(200); expect(m.value().physical).toBe(27); expect(m.value().calls).toBe(6); expect(m.value().maxBind).toBeLessThanOrEqual(100);
  });
  it("24h cleanup is one bounded batch and user/session deletion cascades job metadata only", async () => {
    const s = await setup(), { job } = await s.create(1); expect((await s.apply(job, rows(0, 1))).status).toBe(200);
    const insert = s.db.prepare("INSERT INTO lead_import_jobs(id,workspace_id,user_id,session_id,requested_at,fingerprint,generation,status,total_rows,birth_revision,privacy_epoch,created_at,expires_at,updated_at) VALUES(?,'w','u','session',1,'local','local','active',1,0,0,1,1,1)");
    for (let i = 0; i < 1001; i++) insert.run("expired-" + i);
    const m = meter(s.d1); s.env.DB = m.db; await cleanupLeadImports(s.env);
    expect(m.value().physical).toBe(1); expect(m.value().calls).toBe(1);
    expect(s.db.prepare("SELECT count(*) AS n FROM lead_import_jobs WHERE expires_at=1").all()).toEqual([{ n: 1 }]);
    s.db.exec("DELETE FROM sessions WHERE id='session'");
    expect(s.db.prepare("SELECT count(*) AS n FROM lead_import_jobs").all()).toEqual([{ n: 0 }]);
    expect(s.db.prepare("SELECT count(*) AS n FROM lead_import_owned").all()).toEqual([{ n: 0 }]);
    expect(s.db.prepare("SELECT count(*) AS n FROM leads").all()).toEqual([{ n: 1 }]);
    expect(s.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("20,000 local rows complete as bounded chunks without retaining original contacts in receipts", async () => {
    const s = await setup(), start = await s.create(20_000), m = meter(s.d1); s.env.DB = m.db; let job = start.job;
    for (let offset = 0; offset < 20_000; offset += 100) {
      m.reset(); const response = await s.apply(job, rows(offset)); expect(response.status).toBe(200);
      const result = await response.json() as ImportReceipt; job = result.job;
      expect(m.value().physical).toBeLessThanOrEqual(50); expect(m.value().maxBind).toBeLessThanOrEqual(100); expect(m.value().maxResultBytes).toBeLessThan(16 * 1024);
    }
    expect(job).toMatchObject({ status: "completed", processed: 20_000, imported: 20_000, nextChunk: 200 });
    expect(s.db.prepare("SELECT (SELECT count(*) FROM leads) AS leads,(SELECT count(*) FROM lead_sources) AS sources,(SELECT count(*) FROM lead_import_chunks) AS chunks").all()).toEqual([{ leads: 20_000, sources: 20_000, chunks: 200 }]);
    expect(s.db.prepare("SELECT count(*) AS n FROM lead_import_chunks WHERE result_json LIKE '%@%' OR invalid_json LIKE '%@%' OR skipped_json LIKE '%@%'").all()).toEqual([{ n: 0 }]);
    expect(fetch).not.toHaveBeenCalled();
  }, 30_000);
});
