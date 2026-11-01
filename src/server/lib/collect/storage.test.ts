import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../index";
import { countD1Calls, createSqliteD1, type TestSqlite } from "../../test/sqlite-d1";
import type { PipelineMessage } from "../../jobs";
import type { Envelope, SdkEvent } from "../../../shared/sdk-events";
import type { CollectMessage } from "./consume";
import { INTAKE_TTL_MS, loadCollectMessage, stageCollectIntake } from "./intake";
import { maintainSdkStorage, prepareRawBatch, processRawBatch, RAW_TTL_MS, RAW_WRITE_LEASE_MS } from "./raw";
import { purgeDeletedSites } from "../site-purge";

const NOW = Date.parse("2026-11-01T08:00:00Z"), DAY = 86_400_000;
const closers: (() => void)[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { for (const close of closers.splice(0)) close(); vi.restoreAllMocks(); });
const event = (id = "event-123", extra: Record<string, unknown> = {}): SdkEvent => ({ id, t: "pageview", ts: NOW, url: "https://shop.test/path?private=query", ref: null, title: "PRIVATE-TITLE", ...extra }) as SdkEvent;
const envelope = (events = [event()]): Envelope => ({ v: 1, sdk: "1.0", site: "public-key", anon: "anonymous-id", sess: "session-private", consent: "granted", attr: { first: null, last: { clickId: "private-click", utm: {}, referrerHost: null, landingPath: "/", at: NOW } }, screen: { w: 1, h: 1, dpr: 1 }, sentAt: NOW, events });
const message = (events?: SdkEvent[], extra: Partial<CollectMessage> = {}): CollectMessage => ({ siteId: "s", workspaceId: "w", receivedAt: NOW, country: null, device: "other", envelope: envelope(events), ...extra });
async function setup() {
  const base = await createSqliteD1(); closers.push(base.close);
  base.db.exec(`INSERT INTO workspaces(id,name,created_at) VALUES('w','one',1),('other-w','two',1);
    INSERT INTO sites(id,workspace_id,site_key,name,allowed_domains,created_at) VALUES('s','w','public-key','site','["shop.test"]',1),('other','other-w','other-key','other','[]',1)`);
  const counted = countD1Calls(base.d1), objects = new Map<string, string>(), pipeline: PipelineMessage[] = [], collect: PipelineMessage[] = [];
  const hooks: { put?: (key: string, body: string) => Promise<void>; delete?: (keys: string[]) => Promise<void> } = {};
  const put = vi.fn(async (key: string, body: string) => { await hooks.put?.(key, body); objects.set(key, body); return { key }; });
  const remove = vi.fn(async (value: string | string[]) => { const keys = Array.isArray(value) ? value : [value]; expect(keys.length).toBeLessThanOrEqual(1000); await hooks.delete?.(keys); for (const key of keys) objects.delete(key); });
  const sendBatch = vi.fn(async (batch: { body: PipelineMessage }[]) => { pipeline.push(...batch.map((item) => item.body)); });
  const send = vi.fn(async (body: PipelineMessage) => { collect.push(body); });
  const env = { DB: counted.d1, TOKEN_ENC_KEY: "storage-test-private-key", SITE_EVENTS: { writeDataPoint: vi.fn() }, FILES: { put, delete: remove },
    PIPELINE: { sendBatch }, COLLECT: { send, sendBatch: vi.fn(async (batch: { body: PipelineMessage }[]) => { collect.push(...batch.map((item) => item.body)); }) } } as unknown as Env;
  return { ...base, counted, env, objects, pipeline, collect, hooks, put, remove, sendBatch, send };
}
async function deliver(env: Env, body: PipelineMessage, queue = "avocado-pipeline") {
  const ack = vi.fn(), retry = vi.fn();
  await worker.queue({ queue, messages: [{ body, ack, retry }], ackAll: ack, retryAll: retry } as unknown as MessageBatch<PipelineMessage>, env);
  return { ack, retry };
}
async function stageRaw(env: Env, body = message()) {
  const raw = await prepareRawBatch(env, body.siteId, body.workspaceId, body.receivedAt, body.envelope, body.envelope.events);
  await env.DB.batch([raw.statement]); return raw.id;
}
const count = (db: TestSqlite, table: string) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).all()[0]?.n ?? 0);
function interceptBatches(env: Env, hook: (sql: string[], result: () => Promise<D1Result[]>) => Promise<D1Result[]>) {
  const original = env.DB, statements = new WeakMap<D1PreparedStatement, { original: D1PreparedStatement; sql: string }>();
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const proxy = new Proxy(statement, { get(target, key) { return key === "bind" ? (...values: unknown[]) => wrap(target.bind(...values), sql) : Reflect.get(target, key); } });
    statements.set(proxy, { original: statement, sql }); return proxy;
  };
  env.DB = { ...original, prepare: (sql: string) => wrap(original.prepare(sql), sql), batch: (items: D1PreparedStatement[]) => hook(items.map((item) => statements.get(item)!.sql), () => original.batch(items.map((item) => statements.get(item)!.original))) } as D1Database;
}

describe("SDK durable intake and raw retention", () => {
  it("HTTP keeps the SDK contract, ciphertext intake, ID-only queues and no AE writes", async () => {
    const { env, db, collect, pipeline, objects } = await setup();
    const input = envelope([event(), event("identify-1", { t: "identify", email: "private@example.invalid", name: "PRIVATE-NAME" }), event("track-123", { t: "track", name: "checkout", props: { private: "PRIVATE-PROP" } }),
      event("click-123", { t: "click", sel: "#buy", text: "PRIVATE-TEXT", href: "https://private.test", x: 0.25, y: 0.75, vw: "m" })]);
    const response = await worker.fetch(new Request("https://app.test/collect", { method: "POST", headers: { Origin: "https://shop.test", "User-Agent": "Mozilla/5.0 Chrome/130" }, body: JSON.stringify(input) }), env, {} as ExecutionContext);
    expect(response.status).toBe(204); expect(collect).toEqual([{ type: "collect", payload: { id: expect.any(String) } }]);
    expect(JSON.stringify(db.prepare("SELECT * FROM site_collect_intakes").all())).not.toMatch(/private@example|PRIVATE|private-click|session-private/);
    expect((await deliver(env, collect[0]!, "avocado-collect")).ack).toHaveBeenCalledOnce();
    expect(count(db, "site_collect_intakes")).toBe(0); expect(count(db, "site_raw_batches")).toBe(1);
    expect(pipeline.map((item) => item.type)).toEqual(["collect_identify", "collect_raw"]);
    for (const queued of pipeline) expect(Object.keys(queued.payload as object)).toEqual(["id"]);
    const raw = pipeline.find((item) => item.type === "collect_raw")!;
    await deliver(env, raw); await deliver(env, raw); await deliver(env, collect[0]!, "avocado-collect");
    expect(objects.size).toBe(1); expect(db.prepare("SELECT pageviews,clicks FROM site_sessions").all()).toEqual([{ pageviews: 1, clicks: 1 }]);
    const projection = JSON.parse([...objects.values()][0]!);
    expect(projection.points[3]).toMatchObject({ t: "click", path: "/path", sel: "#buy", x: 0.25, y: 0.75, vw: "m", session: "session-private", clickId: "private-click" });
    expect(JSON.stringify(projection)).not.toMatch(/private@example|PRIVATE|private=query|private.test|anonymous-id/);
    expect(JSON.stringify(db.prepare("SELECT * FROM site_raw_objects").all())).not.toMatch(/private@example|PRIVATE|private-click|session-private|private=query/);
    expect((env as unknown as { SITE_EVENTS: { writeDataPoint: ReturnType<typeof vi.fn> } }).SITE_EVENTS.writeDataPoint).not.toHaveBeenCalled();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("site/workspace/current-age guards reject stale intake, forged legacy, and deletion after HTTP lookup", async () => {
    const { db, env } = await setup();
    expect(await stageCollectIntake(env, message(undefined, { workspaceId: "other-w" }))).toBeNull();
    expect(await stageCollectIntake(env, message(undefined, { receivedAt: NOW - INTAKE_TTL_MS }))).toBeNull();
    expect(await loadCollectMessage(env, { ...message(), workspaceId: 1 })).toBeNull();
    expect(await loadCollectMessage(env, message(undefined, { receivedAt: NOW + 1 }))).toBeNull();
    expect(await loadCollectMessage(env, message(undefined, { receivedAt: NOW - INTAKE_TTL_MS }))).toBeNull();
    const id = (await stageCollectIntake(env, message()))!;
    db.exec("UPDATE sites SET deleted_at=1 WHERE id='s'");
    expect(await stageCollectIntake(env, message())).toBeNull();
    expect(await loadCollectMessage(env, { id })).toBeNull();
    await maintainSdkStorage(env); expect(count(db, "site_collect_intakes")).toBe(0);
  });

  it("a failed COLLECT enqueue remains durable and maintenance recovers it with ID only", async () => {
    const { env, send, collect, db } = await setup(); send.mockRejectedValueOnce(new Error("PRIVATE provider"));
    const response = await worker.fetch(new Request("https://app.test/collect", { method: "POST", headers: { Origin: "https://shop.test", "User-Agent": "Mozilla/5.0 Chrome/130" }, body: JSON.stringify(envelope()) }), env, {} as ExecutionContext);
    expect(response.status).toBe(500); expect(count(db, "site_collect_intakes")).toBe(1);
    vi.mocked(Date.now).mockReturnValue(NOW + 60_000); await maintainSdkStorage(env);
    expect(collect).toHaveLength(1); expect((await deliver(env, collect[0]!, "avocado-collect")).ack).toHaveBeenCalledOnce();
    expect(count(db, "site_collect_intakes")).toBe(0); expect(count(db, "site_raw_batches")).toBe(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("PRIVATE");
  });

  it("stats, fresh raw outbox, dedupe and intake deletion roll back as one batch", async () => {
    const { env, db, pipeline } = await setup(); const id = (await stageCollectIntake(env, message()))!;
    db.exec("CREATE TRIGGER fail_raw BEFORE INSERT ON site_raw_batches BEGIN SELECT RAISE(ABORT,'PRIVATE-SQL'); END");
    expect((await deliver(env, { type: "collect", payload: { id } }, "avocado-collect")).retry).toHaveBeenCalledOnce();
    for (const table of ["site_sessions", "site_daily_stats", "site_event_ids", "site_raw_batches"]) expect(count(db, table)).toBe(0);
    expect(count(db, "site_collect_intakes")).toBe(1); expect(pipeline).toHaveLength(0);
    db.exec("DROP TRIGGER fail_raw"); await deliver(env, { type: "collect", payload: { id } }, "avocado-collect");
    await deliver(env, { type: "collect", payload: message() }, "avocado-collect");
    expect(count(db, "site_raw_batches")).toBe(1); expect(db.prepare("SELECT pageviews FROM site_daily_stats").all()).toEqual([{ pageviews: 1 }]);
  });

  it("soft deletion between collect state read and commit fences statistics and raw together", async () => {
    const { env, db } = await setup(); const id = (await stageCollectIntake(env, message()))!;
    interceptBatches(env, async (sql, run) => {
      if (sql[0]?.includes("collect_lease_lost")) db.exec("UPDATE sites SET deleted_at=1 WHERE id='s'");
      return run();
    });
    expect((await deliver(env, { type: "collect", payload: { id } }, "avocado-collect")).retry).toHaveBeenCalledOnce();
    for (const table of ["site_sessions", "site_event_ids", "site_daily_stats", "site_raw_batches"]) expect(count(db, table)).toBe(0);
    await maintainSdkStorage(env); expect(count(db, "site_collect_intakes")).toBe(0);
  });

  it("lost successful publish response preserves the selected immutable object", async () => {
    const { env, db, objects } = await setup(); const id = await stageRaw(env); let lose = true;
    interceptBatches(env, async (sql, run) => {
      const result = await run();
      if (lose && sql[0]?.includes("SET state='ready'")) { lose = false; throw new Error("PRIVATE lost publish response"); }
      return result;
    });
    await expect(processRawBatch({ id }, env)).rejects.toThrow("sdk_raw_write_failed");
    expect(objects.size).toBe(1); expect(db.prepare("SELECT state FROM site_raw_objects").all()).toEqual([{ state: "ready" }]);
    await processRawBatch({ id }, env); expect(objects.size).toBe(1);
  });

  it("intake age is proved again in the final statistics transaction", async () => {
    const { env, db } = await setup(); const id = (await stageCollectIntake(env, message()))!;
    const original = env.DB.prepare.bind(env.DB);
    env.DB.prepare = (sql) => {
      if (sql.includes("INSERT INTO site_raw_batches")) vi.mocked(Date.now).mockReturnValue(NOW + INTAKE_TTL_MS);
      return original(sql);
    };
    expect((await deliver(env, { type: "collect", payload: { id } }, "avocado-collect")).retry).toHaveBeenCalledOnce();
    expect(count(db, "site_raw_batches")).toBe(0); expect(count(db, "site_sessions")).toBe(0);
    await maintainSdkStorage(env); expect(count(db, "site_collect_intakes")).toBe(0);
  });

  it("ledger insertion must commit before PUT; a failed intent never writes an untracked key", async () => {
    const { env, db, put } = await setup(); const id = await stageRaw(env);
    db.exec("CREATE TRIGGER fail_intent BEFORE INSERT ON site_raw_objects BEGIN SELECT RAISE(ABORT,'PRIVATE'); END");
    await expect(processRawBatch({ id }, env)).rejects.toThrow("sdk_raw_write_failed"); expect(put).not.toHaveBeenCalled();
    expect(count(db, "site_raw_objects")).toBe(0); expect(db.prepare("SELECT status,write_token FROM site_raw_batches").all()).toEqual([{ status: "pending", write_token: null }]);
  });

  it("exhausted raw retries recover from durable outbox; unknown PUT is compensated", async () => {
    const { env, db, pipeline, hooks, objects, put } = await setup(); const id = await stageRaw(env);
    hooks.put = async (key, body) => { objects.set(key, body); throw new Error("PRIVATE uncertain PUT"); };
    for (let i = 0; i < 4; i++) expect((await deliver(env, { type: "collect_raw", payload: { id } })).retry).toHaveBeenCalledOnce();
    expect(objects.size).toBe(0); expect(count(db, "site_raw_objects")).toBe(4);
    hooks.put = undefined; vi.mocked(Date.now).mockReturnValue(NOW + 60_000); await maintainSdkStorage(env);
    const job = pipeline.find((item) => item.type === "collect_raw")!; expect(job).toEqual({ type: "collect_raw", payload: { id } });
    await deliver(env, job); expect(objects.size).toBe(1); expect(put).toHaveBeenCalledTimes(5);
    expect(db.prepare("SELECT status,payload_enc FROM site_raw_batches").all()).toEqual([{ status: "ready", payload_enc: null }]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("PRIVATE");
  });

  it("soft deletion during PUT cannot publish, and repeated tombstone cleanup erases a resurrected late PUT", async () => {
    const { env, db, hooks, objects } = await setup(); const id = await stageRaw(env);
    let lateKey = "", lateBody = "";
    hooks.put = async (key, body) => { lateKey = key; lateBody = body; db.exec("UPDATE sites SET deleted_at=1 WHERE id='s'"); };
    await processRawBatch({ id }, env); expect(objects.size).toBe(0);
    expect(db.prepare("SELECT state,deleted_at IS NOT NULL AS deleted FROM site_raw_objects").all()).toEqual([{ state: "retired", deleted: 1 }]);
    objects.set(lateKey, lateBody); await maintainSdkStorage(env); expect(objects.size).toBe(0);
    expect(count(db, "site_raw_objects")).toBe(1);
  });

  it("a new lease wins while the old PUT resumes; the old attempt never deletes the selected new object", async () => {
    const { env, db, hooks, objects } = await setup(); const id = await stageRaw(env);
    let resume!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; }), waiting = new Promise<void>((resolve) => { started = resolve; }); let first = true;
    hooks.put = async () => { if (first) { first = false; started(); await gate; } };
    const old = processRawBatch({ id }, env); await waiting;
    vi.mocked(Date.now).mockReturnValue(NOW + RAW_WRITE_LEASE_MS + 1); await processRawBatch({ id }, env); resume(); await old;
    expect(objects.size).toBe(1);
    const selected = String(db.prepare("SELECT object_key FROM site_raw_batches").all()[0]!.object_key);
    expect(objects.has(selected)).toBe(true); expect(db.prepare("SELECT state FROM site_raw_objects ORDER BY state").all()).toEqual([{ state: "ready" }, { state: "retired" }]);
  });

  it("30-day purge keeps the parent on R2 failure, preserves other tenants, then cascades D1 only after deletion", async () => {
    const { env, db, objects, hooks } = await setup(); const id = await stageRaw(env); await processRawBatch({ id }, env);
    const other = await stageRaw(env, message(undefined, { siteId: "other", workspaceId: "other-w" })); await processRawBatch({ id: other }, env);
    db.prepare("UPDATE sites SET deleted_at=? WHERE id='s'").run(NOW - 30 * DAY);
    hooks.delete = async () => { throw new Error("PRIVATE deletion failure"); };
    await expect(purgeDeletedSites(env, { scheduledTime: NOW } as ScheduledController)).rejects.toThrow();
    expect(count(db, "sites")).toBe(2); expect(objects.size).toBe(2); expect(count(db, "events")).toBe(0);
    hooks.delete = undefined; await purgeDeletedSites(env, { scheduledTime: NOW } as ScheduledController);
    expect(count(db, "sites")).toBe(1); expect(objects.size).toBe(1);
    expect(db.prepare("SELECT site_id FROM site_raw_batches").all()).toEqual([{ site_id: "other" }]);
    expect(count(db, "site_raw_objects")).toBe(2); expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("an active write lease prevents parent hard deletion even after an R2 DELETE", async () => {
    const { env, db, hooks, objects } = await setup(); const id = await stageRaw(env);
    hooks.put = async () => { db.prepare("UPDATE sites SET deleted_at=? WHERE id='s'").run(NOW - 30 * DAY); await purgeDeletedSites(env, { scheduledTime: NOW } as ScheduledController); expect(count(db, "sites")).toBe(2); };
    await processRawBatch({ id }, env); expect(objects.size).toBe(0);
    vi.mocked(Date.now).mockReturnValue(NOW + RAW_WRITE_LEASE_MS + 1); await purgeDeletedSites(env, { scheduledTime: NOW } as ScheduledController); expect(count(db, "sites")).toBe(1);
  });

  it("active raw technical TTL is 90 days; intake is swept before its 24-hour deadline and budgets stay bounded", async () => {
    const { env, db, objects, counted } = await setup(); const id = await stageRaw(env); await processRawBatch({ id }, env);
    await stageCollectIntake(env, message());
    vi.mocked(Date.now).mockReturnValue(NOW + INTAKE_TTL_MS - 15 * 60_000); await maintainSdkStorage(env); expect(count(db, "site_collect_intakes")).toBe(0); expect(objects.size).toBe(1);
    vi.mocked(Date.now).mockReturnValue(NOW + RAW_TTL_MS - 1); await maintainSdkStorage(env); expect(objects.size).toBe(1);
    vi.mocked(Date.now).mockReturnValue(NOW + RAW_TTL_MS); counted.reset(); await maintainSdkStorage(env);
    expect(objects.size).toBe(0); expect(count(db, "site_raw_batches")).toBe(0); expect(count(db, "sites")).toBe(2); expect(counted.getCalls()).toBeLessThanOrEqual(5);
  });

  it("dispatch failure cannot prevent an independent overdue-site purge", async () => {
    const { env, db, sendBatch } = await setup(); await stageRaw(env, message(undefined, { siteId: "other", workspaceId: "other-w" }));
    db.prepare("UPDATE sites SET deleted_at=? WHERE id='s'").run(NOW - 30 * DAY); sendBatch.mockRejectedValueOnce(new Error("PRIVATE queue"));
    const result = await deliver(env, { type: "privacy_purge", payload: { kind: "sites", scheduledTime: NOW, cron: "*/15 * * * *" } });
    expect(result.retry).toHaveBeenCalledOnce(); expect(db.prepare("SELECT id FROM sites").all()).toEqual([{ id: "other" }]);
  });

  it("workspace cascade cannot erase the independent exact-key deletion evidence", async () => {
    const { env, db, objects } = await setup(); const id = await stageRaw(env); await processRawBatch({ id }, env);
    db.exec("DELETE FROM workspaces WHERE id='w'"); expect(count(db, "site_raw_batches")).toBe(0); expect(count(db, "site_raw_objects")).toBe(1);
    await maintainSdkStorage(env); expect(objects.size).toBe(0); expect(count(db, "site_raw_objects")).toBe(1); expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("Origin, consent and streamed actual byte limits do not create intakes", async () => {
    const { env, db, collect } = await setup();
    for (const [origin, consent, expected] of [["https://other.test", "granted", 403], ["https://shop.test", "denied", 204]] as const) {
      const response = await worker.fetch(new Request("https://app.test/collect", { method: "POST", headers: { Origin: origin, "User-Agent": "Mozilla/5.0 Chrome/130" }, body: JSON.stringify({ ...envelope(), consent }) }), env, {} as ExecutionContext);
      expect(response.status).toBe(expected);
    }
    const cancel = vi.fn(), stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(64 * 1024)); controller.enqueue(new Uint8Array(1)); }, cancel });
    const request = new Request("https://app.test/collect", { method: "POST", headers: { "Content-Length": "1" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    const response = await worker.fetch(request, env, {} as ExecutionContext);
    expect(response.status).toBe(413); expect(cancel).toHaveBeenCalledOnce(); expect(count(db, "site_collect_intakes")).toBe(0); expect(collect).toHaveLength(0);
  });

  it("purge drains 1000 keys per invocation and never reports completion before the last page", async () => {
    const { env, db, objects, pipeline } = await setup(); db.prepare("UPDATE sites SET deleted_at=? WHERE id='s'").run(NOW - 30 * DAY);
    const insert = db.prepare("INSERT INTO site_raw_objects(id,batch_id,site_id,key,state,created_at,lease_until) VALUES(?,'gone','s',?,'ready',1,1)");
    for (let i = 0; i < 1001; i++) { const key = `site-events/s/${i}`; insert.run(`attempt-${i}`, key); objects.set(key, "private raw"); }
    await purgeDeletedSites(env, { scheduledTime: NOW } as ScheduledController);
    expect(objects.size).toBe(1); expect(count(db, "sites")).toBe(2); expect(db.prepare("SELECT name FROM events").all()).toEqual([{ name: "site_privacy_cleanup_progress" }]);
    expect(pipeline).toHaveLength(1); await deliver(env, pipeline[0]!);
    expect(objects.size).toBe(0); expect(count(db, "sites")).toBe(1); expect(count(db, "site_raw_objects")).toBe(1001);
  });

  it("deleting one due site while a second has another key page is progress, never overall completion", async () => {
    const { env, db, objects } = await setup();
    db.prepare("UPDATE sites SET deleted_at=?").run(NOW - 30 * DAY);
    const insert = db.prepare("INSERT INTO site_raw_objects(id,batch_id,site_id,key,state,created_at,lease_until) VALUES(?,'gone','s',?,'ready',1,1)");
    for (let i = 0; i < 1001; i++) { const key = `site-events/s/${i}`; insert.run(`attempt-${i}`, key); objects.set(key, "raw"); }
    await purgeDeletedSites(env, { scheduledTime: NOW } as ScheduledController);
    expect(count(db, "sites")).toBe(1); expect(objects.size).toBe(1);
    const audit = db.prepare("SELECT name,props FROM events").all()[0]!;
    expect(audit.name).toBe("site_privacy_cleanup_progress"); expect(JSON.parse(String(audit.props))).toMatchObject({ sites_deleted: 1, overdue_remaining: 1 });
    await purgeDeletedSites(env, { scheduledTime: NOW } as ScheduledController);
    expect(db.prepare("SELECT name FROM events ORDER BY rowid").all().at(-1)?.name).toBe("site_privacy_cleanup_completed");
  });

  it("new D1 storage children drain in bounded pages before parent deletion", async () => {
    const { env, db, pipeline } = await setup(); db.prepare("UPDATE sites SET deleted_at=? WHERE id='s'").run(NOW - 30 * DAY);
    // Backfill fixtures bypass the insert fence only to represent pre-delete children.
    db.exec("DROP TRIGGER privacy_raw_batch_insert");
    const insert = db.prepare("INSERT INTO site_raw_batches(id,site_id,workspace_id,received_at,expires_at,payload_enc) VALUES(?,'s','w',1,?,'ciphertext')");
    for (let i = 0; i < 1001; i++) insert.run(`raw-${i}`, NOW + DAY);
    await purgeDeletedSites(env, { scheduledTime: NOW } as ScheduledController);
    expect(count(db, "site_raw_batches")).toBe(1); expect(count(db, "sites")).toBe(2); expect(pipeline).toHaveLength(1);
    await purgeDeletedSites(env, { scheduledTime: NOW } as ScheduledController); expect(count(db, "site_raw_batches")).toBe(0); expect(count(db, "sites")).toBe(1);
  });
});
