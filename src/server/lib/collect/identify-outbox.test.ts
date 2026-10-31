import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, type TestSqlite } from "../../test/sqlite-d1";
import { decryptToken } from "../crypto";
import { sha256Hex } from "../ids";
import { IDENTIFY_DISPATCH_LIMIT, IDENTIFY_MAINTENANCE_LIMIT, maintainIdentifyJobs, prepareIdentifyJobs, processIdentifyJob } from "./identify-outbox";
import { MAX_IDENTIFY_AGE_MS, type IdentifyJob } from "./people";

const NOW = Date.parse("2026-11-01T00:00:00Z");
const closers: (() => void)[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); });
afterEach(() => { for (const close of closers.splice(0)) close(); vi.restoreAllMocks(); });
const job = (id = "event", extra: Partial<IdentifyJob> = {}): IdentifyJob => ({
  site: { id: "site", workspaceId: "w", collectRawEmail: true }, sessionId: "session", anonId: "anon", linkId: null,
  receivedAt: NOW, event: { id, t: "identify", ts: NOW, url: "https://shop.test", ref: null, email: "PRIVATE@example.com", name: "PRIVATE-NAME", externalId: "PRIVATE-EXTERNAL" }, ...extra,
});
async function setup() {
  const base = await createSqliteD1(); closers.push(base.close);
  base.db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w','team',1)");
  base.db.exec("INSERT INTO sites(id,workspace_id,site_key,name,allowed_domains,collect_raw_email,created_at) VALUES('site','w','key','site','[]',1,1)");
  base.db.exec("INSERT INTO site_sessions(site_id,id,anon_id,first_at,last_at) VALUES('site','session','anon',1,2)");
  const sendBatch = vi.fn();
  const env = { DB: base.d1, TOKEN_ENC_KEY: "private-encryption-key", PIPELINE: { sendBatch } } as unknown as Env;
  const stage = async (jobs = [job()]) => { const prepared = await prepareIdentifyJobs(env, jobs); if (prepared.statement) await env.DB.batch([prepared.statement]); return prepared.ids; };
  return { ...base, env, stage, sendBatch };
}
const count = (db: TestSqlite, table: string) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).all()[0]!.n);

// Counts physical SQL statements, including each statement inside a native batch.
function countPhysical(db: D1Database) {
  let statements = 0;
  const originalPrepare = db.prepare.bind(db), originalBatch = db.batch.bind(db);
  vi.spyOn(db, "prepare").mockImplementation((sql) => {
    const prepared = originalPrepare(sql);
    const wrap = (s: D1PreparedStatement): D1PreparedStatement => new Proxy(s, { get(target, key) {
      if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values));
      if (["all", "first", "run", "raw"].includes(String(key))) return (...args: unknown[]) => { statements++; return Reflect.get(target, key).apply(target, args); };
      return Reflect.get(target, key);
    } });
    return wrap(prepared);
  });
  vi.spyOn(db, "batch").mockImplementation((batch) => { statements += batch.length; return originalBatch(batch); });
  return { get: () => statements, reset: () => { statements = 0; } };
}

describe("durable identify effects", () => {
  it("SDK insert and profile merge store whole-field Unicode folds before marking the claim done", async () => {
    const { db, env, stage } = await setup(); const firstJob = job("first", { event: { ...job().event, id: "first", name: "ΟΣ" } });
    const [first] = await stage([firstJob]); await processIdentifyJob({ id: first! }, env);
    expect(db.prepare("SELECT search_email_v1,search_name_v1,search_company_v1,search_phone_v1 FROM leads").all()).toEqual([{ search_email_v1: "private@example.com", search_name_v1: "ος", search_company_v1: "", search_phone_v1: "" }]);
    const [second] = await stage([job("second", { event: { ...job().event, id: "second", name: "İ" } })]); await processIdentifyJob({ id: second! }, env);
    expect(db.prepare("SELECT name,search_name_v1 FROM leads").all()).toEqual([{ name: "İ", search_name_v1: "i̇" }]);
    expect(db.prepare("SELECT status,payload_enc FROM site_identify_jobs WHERE id=?").all(second!)).toEqual([{ status: "done", payload_enc: null }]);
  });
  it("turning off raw collection before the claim also fences the search writer", async () => {
    const { db, env, stage } = await setup(); const [first] = await stage(); await processIdentifyJob({ id: first! }, env);
    db.exec("UPDATE leads SET name='OLD'; UPDATE sites SET collect_raw_email=0");
    const [second] = await stage([job("second", { event: { ...job().event, id: "second", name: "PRIVATE-NEW" } })]); await processIdentifyJob({ id: second! }, env);
    expect(db.prepare("SELECT name,search_name_v1 FROM leads").all()).toEqual([{ name: "OLD", search_name_v1: null }]);
  });
  it("bulk stages 50 encrypted jobs in one physical statement and sends only IDs", async () => {
    const { db, d1, env, stage, sendBatch } = await setup(); const calls = countPhysical(d1);
    const ids = await stage(Array.from({ length: 50 }, (_, i) => job(`event-${i}`)));
    expect(calls.get()).toBe(1); expect(ids).toHaveLength(50); expect(new Set(ids).size).toBe(50);
    const stored = JSON.stringify(db.prepare("SELECT * FROM site_identify_jobs").all());
    expect(stored).not.toMatch(/PRIVATE|private@example.com|PRIVATE-NAME|https:\/\/shop/);
    await maintainIdentifyJobs(env);
    expect(sendBatch).toHaveBeenCalledOnce();
    expect(sendBatch.mock.calls[0]![0]).toHaveLength(50);
    for (const item of sendBatch.mock.calls[0]![0]) expect(item).toEqual({ body: { type: "collect_identify", payload: { id: expect.any(String) } } });
  });

  it("current SQL raw flag selects minimal ciphertext even when disabled after encryption", async () => {
    const { db, env } = await setup();
    const prepared = await prepareIdentifyJobs(env, [job()]);
    db.exec("UPDATE sites SET collect_raw_email=0");
    await env.DB.batch([prepared.statement!]);
    const encrypted = String(db.prepare("SELECT payload_enc FROM site_identify_jobs").all()[0]!.payload_enc);
    expect(JSON.parse(await decryptToken(env.TOKEN_ENC_KEY!, encrypted))).toEqual({ email: null, name: null, externalId: "PRIVATE-EXTERNAL", linkId: null });
    await processIdentifyJob({ id: prepared.ids[0]! }, env);
    expect(count(db, "leads")).toBe(0);
    expect(db.prepare("SELECT email_hash, lead_id FROM site_people").all()).toEqual([{ email_hash: await sha256Hex("private@example.com"), lead_id: null }]);
  });

  it("raw consent withdrawn after the pending payload is loaded blocks raw lead creation at execution", async () => {
    const { db, d1, env, stage } = await setup(); const [id] = await stage(); const batch = d1.batch.bind(d1);
    vi.spyOn(d1, "batch").mockImplementation(async (statements) => { db.exec("UPDATE sites SET collect_raw_email=0"); return batch(statements); });
    await processIdentifyJob({ id: id! }, env);
    expect(count(db, "leads")).toBe(0); expect(count(db, "lead_sources")).toBe(0);
    expect(db.prepare("SELECT email_hash,lead_id FROM site_people").all()).toEqual([{ email_hash: await sha256Hex("private@example.com"), lead_id: null }]);
    expect(db.prepare("SELECT payload_enc,status FROM site_identify_jobs").all()).toEqual([{ payload_enc: null, status: "done" }]);
  });

  it("mid-effect failure rolls back every effect and retries from a durable sanitized pending row", async () => {
    const { db, env, stage } = await setup(); const [id] = await stage();
    db.exec("CREATE TRIGGER fail_identify BEFORE INSERT ON site_people BEGIN SELECT RAISE(ABORT,'PRIVATE@example.com PRIVATE-NAME'); END");
    await expect(processIdentifyJob({ id: id! }, env)).rejects.toThrow(/^identify_job_failed$/);
    for (const table of ["leads", "lead_sources", "site_people"]) expect(count(db, table)).toBe(0);
    expect(db.prepare("SELECT status, claim_token, attempts, last_error, payload_enc IS NOT NULL AS encrypted FROM site_identify_jobs").all()).toEqual([{ status: "pending", claim_token: null, attempts: 1, last_error: "identify_job_failed", encrypted: 1 }]);
    db.exec("DROP TRIGGER fail_identify"); await processIdentifyJob({ id: id! }, env);
    for (const table of ["leads", "lead_sources", "site_people"]) expect(count(db, table)).toBe(1);
    expect(db.prepare("SELECT status, payload_enc, claim_token FROM site_identify_jobs").all()).toEqual([{ status: "done", payload_enc: null, claim_token: null }]);
  });

  it("a lost commit response and concurrent replay produce exactly one source and person", async () => {
    const { db, d1, env, stage } = await setup(); const [id] = await stage();
    const batch = d1.batch.bind(d1); let loseResponse = true;
    vi.spyOn(d1, "batch").mockImplementation(async (statements) => { const result = await batch(statements); if (loseResponse) { loseResponse = false; throw new Error("PRIVATE response loss"); } return result; });
    await expect(processIdentifyJob({ id: id! }, env)).rejects.toThrow(/^identify_job_failed$/);
    await Promise.all([processIdentifyJob({ id: id! }, env), processIdentifyJob({ id: id! }, env)]);
    for (const table of ["leads", "lead_sources", "site_people"]) expect(count(db, table)).toBe(1);
    expect(db.prepare("SELECT attempts, status, payload_enc FROM site_identify_jobs").all()).toEqual([{ attempts: 1, status: "done", payload_enc: null }]);
  });

  it("two independently loaded jobs choose one current canonical person without a stale JS lookup", async () => {
    const { db, env, stage } = await setup(); const ids = await stage([job("first"), job("second")]);
    await Promise.all(ids.map((id) => processIdentifyJob({ id }, env)));
    expect(count(db, "leads")).toBe(1); expect(count(db, "site_people")).toBe(1); expect(count(db, "lead_sources")).toBe(2);
    expect(new Set(db.prepare("SELECT resolved_person_id FROM site_identify_jobs").all().map((r) => r.resolved_person_id)).size).toBe(1);
  });

  it("a supplied different hash never merges through an existing anonymous or external ID", async () => {
    const { db, env, stage } = await setup();
    const [first] = await stage(); await processIdentifyJob({ id: first! }, env);
    const [second] = await stage([job("different", { event: { ...job().event, id: "different", email: "other@example.com" } })]);
    await processIdentifyJob({ id: second! }, env);
    expect(count(db, "site_people")).toBe(2); expect(count(db, "leads")).toBe(2);
    expect(new Set(db.prepare("SELECT email_hash FROM site_people").all().map((r) => r.email_hash)).size).toBe(2);
  });

  it.each(["site", "session", "workspace"])("a current %s boundary changed after job load blocks every effect", async (boundary) => {
    const { db, d1, env, stage } = await setup(); const [id] = await stage(); const batch = d1.batch.bind(d1);
    vi.spyOn(d1, "batch").mockImplementation(async (statements) => {
      if (boundary === "site") db.exec(`UPDATE sites SET deleted_at=${NOW}`);
      if (boundary === "session") db.exec("UPDATE site_sessions SET anon_id='other-anon'");
      if (boundary === "workspace") { db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('other','other',1)"); db.exec("UPDATE sites SET workspace_id='other'"); }
      return batch(statements);
    });
    await processIdentifyJob({ id: id! }, env);
    for (const table of ["leads", "lead_sources", "site_people"]) expect(count(db, table)).toBe(0);
    expect(db.prepare("SELECT status, payload_enc FROM site_identify_jobs").all()).toEqual([{ status: "cancelled", payload_enc: null }]);
  });

  it("the original received time expires retries without decrypting or refreshing it", async () => {
    const { db, env, stage } = await setup(); const [id] = await stage();
    vi.mocked(Date.now).mockReturnValue(NOW + MAX_IDENTIFY_AGE_MS);
    env.TOKEN_ENC_KEY = undefined;
    await processIdentifyJob({ id: id! }, env);
    expect(count(db, "leads")).toBe(0);
    expect(db.prepare("SELECT status, received_at, expires_at, payload_enc FROM site_identify_jobs").all()).toEqual([{ status: "expired", received_at: NOW, expires_at: NOW + MAX_IDENTIFY_AGE_MS, payload_enc: null }]);
  });

  it("all effects plus receipt and search folds fit 14 physical SQL statements; completed replay needs one", async () => {
    const { d1, env, stage } = await setup(); const [id] = await stage(); const calls = countPhysical(d1);
    await processIdentifyJob({ id: id! }, env); expect(calls.get()).toBe(14);
    calls.reset(); await processIdentifyJob({ id: id! }, env); expect(calls.get()).toBe(1);
  });

  it("failed effect work uses at most 15 physical statements including sanitized retry metadata", async () => {
    const { db, d1, env, stage } = await setup(); const [id] = await stage(); const calls = countPhysical(d1);
    db.exec("CREATE TRIGGER fail_identify BEFORE INSERT ON site_people BEGIN SELECT RAISE(ABORT,'PRIVATE'); END");
    await expect(processIdentifyJob({ id: id! }, env)).rejects.toThrow(/^identify_job_failed$/);
    expect(calls.get()).toBe(15);
  });

  it("legacy duplicate people are preserved and one canonical ID is selected deterministically", async () => {
    const { db, env, stage } = await setup(); const hash = await sha256Hex("private@example.com");
    db.prepare("INSERT INTO site_people(id,site_id,anon_ids,email_hash,created_at) VALUES('legacy-a','site','[]',?,1),('legacy-b','site','[]',?,1)").run(hash, hash);
    const [id] = await stage(); await processIdentifyJob({ id: id! }, env);
    expect(db.prepare("SELECT id FROM site_people ORDER BY id").all()).toEqual([{ id: "legacy-a" }, { id: "legacy-b" }]);
    expect(db.prepare("SELECT resolved_person_id FROM site_identify_jobs").all()).toEqual([{ resolved_person_id: "legacy-a" }]);
  });

  it("newer-first same-hash delivery keeps one canonical person without adding old aliases or overwriting a fresh profile", async () => {
    const { db, env, stage } = await setup();
    db.exec("INSERT INTO site_sessions(site_id,id,anon_id,first_at,last_at) VALUES('site','older-session','older-anon',1,2)");
    const [older, newer] = await stage([
      job("older-event", { sessionId: "older-session", anonId: "older-anon", receivedAt: NOW - 1000, event: { ...job().event, id: "older-event", name: "OLD-PROFILE" } }),
      job("newer-event", { event: { ...job().event, id: "newer-event", name: "NEW-PROFILE" } }),
    ]);
    await processIdentifyJob({ id: newer! }, env);
    const before = db.prepare("SELECT person_id FROM site_sessions WHERE id='older-session'").all();
    await processIdentifyJob({ id: older! }, env);
    expect(count(db, "site_people")).toBe(1); expect(count(db, "leads")).toBe(1); expect(count(db, "lead_sources")).toBe(1);
    expect(db.prepare("SELECT name FROM leads").all()).toEqual([{ name: "NEW-PROFILE" }]);
    expect(db.prepare("SELECT anon_ids FROM site_people").all()).toEqual([{ anon_ids: '["anon"]' }]);
    expect(db.prepare("SELECT person_id FROM site_sessions WHERE id='older-session'").all()).toEqual(before);
    expect(db.prepare("SELECT status,payload_enc FROM site_identify_jobs").all()).toEqual([{ status: "done", payload_enc: null }, { status: "done", payload_enc: null }]);
  });

  it.each(["external", "anon"])("newer-first %s identity uses the current canonical without duplicating a person", async (mode) => {
    const { db, env, stage } = await setup();
    const oldAnon = mode === "anon" ? "anon" : "older-anon";
    db.prepare("INSERT INTO site_sessions(site_id,id,anon_id,first_at,last_at) VALUES('site','older-session',?,1,2)").run(oldAnon);
    const identity = { ...job().event, email: undefined, externalId: mode === "external" ? "same-external" : undefined };
    const [older, newer] = await stage([
      job("older-event", { sessionId: "older-session", anonId: oldAnon, receivedAt: NOW - 1000, event: { ...identity, id: "older-event" } }),
      job("newer-event", { event: { ...identity, id: "newer-event" } }),
    ]);
    await processIdentifyJob({ id: newer! }, env);
    const before = db.prepare("SELECT person_id FROM site_sessions WHERE id='older-session'").all();
    await processIdentifyJob({ id: older! }, env);
    expect(count(db, "site_people")).toBe(1);
    expect(db.prepare("SELECT anon_ids FROM site_people").all()).toEqual([{ anon_ids: '["anon"]' }]);
    expect(db.prepare("SELECT person_id FROM site_sessions WHERE id='older-session'").all()).toEqual(before);
  });

  it("an older retry cannot overwrite the latest profile/source on a pre-existing lead", async () => {
    const { db, env, stage } = await setup(); const hash = await sha256Hex("private@example.com");
    db.prepare("INSERT INTO leads(id,workspace_id,email,name,answers,unsubscribe_token,first_source,last_source,email_hash,created_at) VALUES('existing','w','private@example.com','INITIAL','{}','existing-token','{}','{\"at\":1}',?,1)").run(hash);
    const [older, newer] = await stage([
      job("older-event", { receivedAt: NOW - 1000, event: { ...job().event, id: "older-event", name: "OLD-PROFILE" } }),
      job("newer-event", { event: { ...job().event, id: "newer-event", name: "NEW-PROFILE" } }),
    ]);
    await processIdentifyJob({ id: newer! }, env); await processIdentifyJob({ id: older! }, env);
    expect(db.prepare("SELECT name,json_extract(last_source,'$.at') AS at FROM leads").all()).toEqual([{ name: "NEW-PROFILE", at: NOW }]);
    expect(count(db, "site_people")).toBe(1); expect(count(db, "lead_sources")).toBe(2);
  });

  it("missing encryption config fails closed and reports no event values", async () => {
    const { db, env, stage } = await setup(); env.TOKEN_ENC_KEY = undefined;
    await expect(stage()).rejects.toThrow(/^identify_job_failed$/); expect(count(db, "site_identify_jobs")).toBe(0);
  });

  it("future, nonfinite and already-expired server times never stage contact data", async () => {
    const { db, stage } = await setup();
    expect(await stage([NaN, Infinity, NOW + 1, NOW - MAX_IDENTIFY_AGE_MS, NOW - MAX_IDENTIFY_AGE_MS - 1].map((receivedAt, i) => job(`invalid-${i}`, { receivedAt })))).toEqual([]);
    expect(count(db, "site_identify_jobs")).toBe(0);
  });

  it("maintenance scrubs at most 100 inactive payloads and eventually drains the remainder", async () => {
    const { db, env, stage, sendBatch } = await setup();
    await stage(Array.from({ length: IDENTIFY_MAINTENANCE_LIMIT + 1 }, (_, i) => job(`inactive-${i}`)));
    db.exec(`UPDATE sites SET deleted_at=${NOW}`);
    await maintainIdentifyJobs(env);
    expect(db.prepare("SELECT count(*) AS n FROM site_identify_jobs WHERE status='cancelled' AND payload_enc IS NULL").all()[0]!.n).toBe(IDENTIFY_MAINTENANCE_LIMIT);
    expect(db.prepare("SELECT count(*) AS n FROM site_identify_jobs WHERE payload_enc IS NOT NULL").all()[0]!.n).toBe(1);
    expect(sendBatch).not.toHaveBeenCalled();
    await maintainIdentifyJobs(env);
    expect(db.prepare("SELECT count(*) AS n FROM site_identify_jobs WHERE payload_enc IS NOT NULL").all()[0]!.n).toBe(0);
  });

  it("failed queue dispatch retains pending work and the next maintenance retry sends IDs only", async () => {
    const { db, env, stage, sendBatch } = await setup(); const [id] = await stage();
    sendBatch.mockRejectedValueOnce(new Error("PRIVATE@example.com queue failure"));
    await expect(maintainIdentifyJobs(env)).rejects.toThrow(/^identify_job_failed$/);
    expect(db.prepare("SELECT status,payload_enc IS NOT NULL AS encrypted FROM site_identify_jobs").all()).toEqual([{ status: "pending", encrypted: 1 }]);
    vi.mocked(Date.now).mockReturnValue(NOW + 60_000); await maintainIdentifyJobs(env);
    expect(sendBatch.mock.calls[1]![0]).toEqual([{ body: { type: "collect_identify", payload: { id } } }]);
  });

  it("maintenance bounds expired cleanup, inactive scrubbing and retry dispatch", async () => {
    const { db, env, stage, sendBatch } = await setup();
    const ids = await stage(Array.from({ length: IDENTIFY_MAINTENANCE_LIMIT + 1 }, (_, i) => job(`expired-${i}`)));
    db.prepare("UPDATE site_identify_jobs SET expires_at=?").run(NOW - 1);
    await stage(Array.from({ length: IDENTIFY_DISPATCH_LIMIT + 1 }, (_, i) => job(`pending-${i}`)));
    await maintainIdentifyJobs(env);
    expect(count(db, "site_identify_jobs")).toBe(1 + IDENTIFY_DISPATCH_LIMIT + 1);
    expect(sendBatch.mock.calls[0]![0]).toHaveLength(IDENTIFY_DISPATCH_LIMIT);
    expect(db.prepare("SELECT count(*) AS n FROM site_identify_jobs WHERE id IN (SELECT value FROM json_each(?))").all(JSON.stringify(ids))[0]!.n).toBe(1);
  });
});
