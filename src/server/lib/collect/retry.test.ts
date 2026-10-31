import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope, SdkEvent } from "../../../shared/sdk-events";
import worker from "../../index";
import type { PipelineMessage } from "../../jobs";
import { createSqliteD1 } from "../../test/sqlite-d1";
import { sessionDelta } from "./aggregate";

const NOW = Date.parse("2026-11-01T04:00:00Z");
const closers: (() => void)[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { for (const close of closers.splice(0)) close(); vi.restoreAllMocks(); });
const event = (id: string, extra: Record<string, unknown> = {}): SdkEvent => ({ id, t: "pageview", ts: NOW, url: "https://shop.test", ref: null, title: "QA", ...extra }) as SdkEvent;
function envelope(events: SdkEvent[], extra: Partial<Envelope> = {}): Envelope {
  return { v: 1, sdk: "1.0.0", site: "site-key", anon: "anon_12345678", sess: "sess_12345678", consent: "granted", attr: { first: null, last: null }, screen: { w: 390, h: 844, dpr: 2 }, sentAt: NOW, events, ...extra };
}
function meter(base: D1Database) {
  let api = 0, physical = 0, binds = 0;
  const sqls = new WeakMap<D1PreparedStatement, string>();
  const hooks: { before?: (sql: string) => Promise<void> | void; batch?: (sql: string[]) => Promise<void> | void; loseResponse?: boolean } = {};
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const proxy = new Proxy(statement, { get(target, key) {
      if (key === "bind") return (...values: unknown[]) => { binds = Math.max(binds, values.length); expect(values.length).toBeLessThanOrEqual(100); return wrap(target.bind(...values), sql); };
      if (["first", "all", "run", "raw"].includes(String(key))) return async (...args: unknown[]) => { api++; physical++; await hooks.before?.(sql); return Reflect.get(target, key).apply(target, args); };
      return Reflect.get(target, key);
    } });
    sqls.set(proxy, sql); return proxy;
  };
  const d1 = { ...base, prepare: (sql: string) => wrap(base.prepare(sql), sql), batch: async (statements: D1PreparedStatement[]) => {
    api++; physical += statements.length; await hooks.batch?.(statements.map((statement) => sqls.get(statement) ?? ""));
    const result = await base.batch(statements);
    if (hooks.loseResponse) { hooks.loseResponse = false; throw new Error("PRIVATE commit response lost"); }
    return result;
  } } as D1Database;
  return { d1, hooks, stats: () => ({ api, physical, binds }), reset: () => { api = physical = binds = 0; } };
}
async function setup() {
  const base = await createSqliteD1(); closers.push(base.close);
  base.db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w','QA',1)");
  base.db.exec("INSERT INTO sites(id,workspace_id,site_key,name,allowed_domains,collect_raw_email,created_at) VALUES('site','w','site-key','QA','[\"shop.test\"]',1,1)");
  const counted = meter(base.d1), sent: PipelineMessage[] = [];
  const sendBatch = vi.fn(async (batch: { body: PipelineMessage }[]) => { sent.push(...batch.map((item) => item.body)); });
  const env = { DB: counted.d1, TOKEN_ENC_KEY: "collect-retry-private-key", PIPELINE: { sendBatch } } as unknown as Env;
  return { ...base, ...counted, env, sent, sendBatch };
}
async function deliver(env: Env, body: PipelineMessage, queue = "avocado-collect") {
  let action: "ack" | "retry" | null = null;
  const ack = vi.fn(() => { action ??= "ack"; }), retry = vi.fn(() => { action ??= "retry"; });
  const message = { body, ack, retry }, ackAll = vi.fn(() => ack()), retryAll = vi.fn(() => retry());
  await worker.queue({ queue, messages: [message], ackAll, retryAll } as unknown as MessageBatch<PipelineMessage>, env);
  return { ack, retry, ackAll, retryAll, action };
}
const collect = (env: Env, body: Envelope) => deliver(env, { type: "collect", payload: { siteId: "site", workspaceId: "w", receivedAt: NOW, country: null, device: "other", envelope: body } });

describe("collect lease, outbox and Worker redelivery", () => {
  it("identify 오류 뒤 집계는 한 번만 남고 같은 pending ID가 재시도된다", async () => {
    const { db, env, sent } = await setup();
    const body = envelope([event("pageview1"), event("identify1", { t: "identify", email: "private@example.invalid", name: "PRIVATE-NAME" })]);
    expect((await collect(env, body)).action).toBe("ack"); expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ type: "collect_identify", payload: { id: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(JSON.stringify(db.prepare("SELECT * FROM site_identify_jobs").all())).not.toMatch(/private@example|PRIVATE-NAME/);
    db.exec("CREATE TRIGGER fail_identity BEFORE INSERT ON site_people BEGIN SELECT RAISE(ABORT,'PRIVATE-NAME'); END");
    expect((await deliver(env, sent[0]!, "avocado-pipeline")).action).toBe("retry");
    expect(db.prepare("SELECT status FROM site_identify_jobs").all()).toEqual([{ status: "pending" }]);
    expect((await collect(env, body)).action).toBe("ack"); expect(sent).toHaveLength(1);
    db.exec("DROP TRIGGER fail_identity"); expect((await deliver(env, sent[0]!, "avocado-pipeline")).action).toBe("ack");
    expect(db.prepare("SELECT pageviews FROM site_sessions").all()).toEqual([{ pageviews: 1 }]);
    expect(db.prepare("SELECT pageviews FROM site_daily_stats").all()).toEqual([{ pageviews: 1 }]);
    expect(db.prepare("SELECT count(*) AS n FROM leads").all()).toEqual([{ n: 1 }]);
    expect(db.prepare("SELECT count(*) AS n FROM lead_sources").all()).toEqual([{ n: 1 }]);
    expect(db.prepare("SELECT status,payload_enc FROM site_identify_jobs").all()).toEqual([{ status: "done", payload_enc: null }]);
  });

  it.each(["site_event_ids", "site_identify_jobs"])("%s SQL 실패는 첫 소유권 proof부터 마지막 release까지 모두 롤백한다", async (table) => {
    const { db, env, sent } = await setup();
    db.exec(`CREATE TRIGGER fail_collect BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'PRIVATE failure'); END`);
    const body = envelope([event("pageview1"), event("identify1", { t: "identify", email: "private@example.invalid" })]);
    expect((await collect(env, body)).action).toBe("retry");
    for (const name of ["site_sessions", "site_daily_stats", "site_event_ids", "site_identify_jobs", "site_collect_leases"]) expect(db.prepare(`SELECT count(*) AS n FROM ${name}`).all()).toEqual([{ n: 0 }]);
    expect(sent).toHaveLength(0); db.exec("DROP TRIGGER fail_collect");
    expect((await collect(env, body)).action).toBe("ack"); expect(sent).toHaveLength(1);
  });

  it("동시에 같은 봉투를 전달해도 lease가 겹친 집계를 막고 후속 redelivery도 증가시키지 않는다", async () => {
    const { db, env } = await setup(); const body = envelope([event("pageview1")]);
    const result = await Promise.all([collect(env, body), collect(env, body)]);
    expect(result.some((item) => item.action === "retry")).toBe(true);
    expect((await collect(env, body)).action).toBe("ack");
    expect(db.prepare("SELECT pageviews FROM site_sessions").all()).toEqual([{ pageviews: 1 }]);
    expect(db.prepare("SELECT pageviews FROM site_daily_stats").all()).toEqual([{ pageviews: 1 }]);
    expect(db.prepare("SELECT count(*) AS n FROM site_collect_leases").all()).toEqual([{ n: 0 }]);
  });

  it("lease 시간이 지나도 토큰을 빼앗기지 않았다면 commit한다", async () => {
    const { env, hooks, db } = await setup();
    hooks.batch = (sql) => { if (sql[0]?.includes("collect_lease_lost")) vi.mocked(Date.now).mockReturnValue(NOW + 31_000); };
    expect((await collect(env, envelope([event("pageview1")]))).action).toBe("ack");
    expect(db.prepare("SELECT pageviews FROM site_sessions").all()).toEqual([{ pageviews: 1 }]);
  });

  it("만료 뒤 새 토큰이 소유권을 얻으면 옛 batch는 증분을 전부 거절한다", async () => {
    const { env, hooks, db } = await setup(); let resume!: () => void, waiting!: () => void;
    const paused = new Promise<void>((resolve) => { waiting = resolve; }), gate = new Promise<void>((resolve) => { resume = resolve; }); let once = false;
    hooks.before = async (sql) => { if (!once && sql.startsWith("SELECT id, workspace_id AS workspaceId, currency")) { once = true; waiting(); await gate; } };
    const old = collect(env, envelope([event("old-page")])); await paused;
    vi.mocked(Date.now).mockReturnValue(NOW + 31_000);
    expect((await collect(env, envelope([event("new-page")]))).action).toBe("ack"); resume();
    expect((await old).action).toBe("retry");
    expect(db.prepare("SELECT id FROM site_event_ids ORDER BY id").all()).toEqual([{ id: "new-page" }]);
    expect((await collect(env, envelope([event("old-page")]))).action).toBe("ack");
    expect(db.prepare("SELECT pageviews FROM site_sessions").all()).toEqual([{ pageviews: 2 }]);
  });

  it("커밋 응답을 잃어도 집계·작업은 한 번만 쓰고 maintenance가 누락 enqueue를 복구한다", async () => {
    const { env, db, hooks, sent } = await setup();
    hooks.batch = (sql) => { if (sql[0]?.includes("collect_lease_lost")) { hooks.loseResponse = true; hooks.batch = undefined; } };
    const body = envelope([event("pageview1"), event("identify1", { t: "identify", email: "private@example.invalid" })]);
    expect((await collect(env, body)).action).toBe("retry"); expect(sent).toHaveLength(0);
    expect((await collect(env, body)).action).toBe("ack"); expect(sent).toHaveLength(0);
    expect((await deliver(env, { type: "cleanup_google_sheets", payload: {} }, "avocado-pipeline")).action).toBe("ack"); expect(sent).toHaveLength(1);
    expect(db.prepare("SELECT pageviews FROM site_sessions").all()).toEqual([{ pageviews: 1 }]);
    expect((await deliver(env, sent[0]!, "avocado-pipeline")).action).toBe("ack");
    expect(db.prepare("SELECT count(*) AS n FROM site_people").all()).toEqual([{ n: 1 }]);
  });

  it("enqueue 실패 증거를 보존하고 다음 maintenance가 같은 작업을 보낸다", async () => {
    const { env, db, sent, sendBatch } = await setup(); sendBatch.mockRejectedValueOnce(new Error("PRIVATE provider failure"));
    const body = envelope([event("identify1", { t: "identify", emailHash: "a".repeat(64) })]);
    expect((await collect(env, body)).action).toBe("retry");
    expect(db.prepare("SELECT last_error,status FROM site_identify_jobs").all()).toEqual([{ last_error: "identify_enqueue_failed", status: "pending" }]);
    expect((await deliver(env, { type: "cleanup_google_sheets", payload: {} }, "avocado-pipeline")).action).toBe("ack"); expect(sent).toHaveLength(1);
  });

  it("Queue 재시도 네 번이 실패해도 pending 원장이 다음 maintenance에서 복구된다", async () => {
    const { env, db, sent } = await setup();
    await collect(env, envelope([event("pageview1"), event("identify1", { t: "identify", email: "private@example.invalid" })]));
    const original = sent[0]!;
    db.exec("CREATE TRIGGER fail_identity BEFORE INSERT ON site_people BEGIN SELECT RAISE(ABORT,'PRIVATE'); END");
    for (let i = 0; i < 4; i++) expect((await deliver(env, original, "avocado-pipeline")).action).toBe("retry");
    expect(db.prepare("SELECT status,attempts,payload_enc IS NOT NULL AS encrypted FROM site_identify_jobs").all()).toEqual([{ status: "pending", attempts: 4, encrypted: 1 }]);
    db.exec("DROP TRIGGER fail_identity"); vi.mocked(Date.now).mockReturnValue(NOW + 60_000);
    await deliver(env, { type: "cleanup_google_sheets", payload: {} }, "avocado-pipeline");
    expect(sent.at(-1)).toEqual(original); expect((await deliver(env, sent.at(-1)!, "avocado-pipeline")).action).toBe("ack");
    expect(db.prepare("SELECT pageviews FROM site_daily_stats").all()).toEqual([{ pageviews: 1 }]);
    expect(db.prepare("SELECT count(*) AS n FROM lead_sources").all()).toEqual([{ n: 1 }]);
  });

  it("마지막 lease release SQL 실패도 집계·dedupe·outbox를 함께 롤백한다", async () => {
    const { env, db } = await setup();
    db.exec("CREATE TRIGGER fail_release BEFORE DELETE ON site_collect_leases BEGIN SELECT RAISE(ABORT,'PRIVATE'); END");
    const body = envelope([event("pageview1"), event("identify1", { t: "identify", emailHash: "a".repeat(64) })]);
    expect((await collect(env, body)).action).toBe("retry");
    for (const table of ["site_sessions", "site_daily_stats", "site_event_ids", "site_identify_jobs"]) expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).all()).toEqual([{ n: 0 }]);
    db.exec("DROP TRIGGER fail_release"); vi.mocked(Date.now).mockReturnValue(NOW + 31_000);
    expect((await collect(env, body)).action).toBe("ack"); expect(db.prepare("SELECT pageviews FROM site_sessions").all()).toEqual([{ pageviews: 1 }]);
  });

  it("최대50전환/50identify도 JSON bulk로 physical SQL 50회 안에 머문다", async () => {
    const { env, stats, reset, hooks } = await setup(); const attr = { first: null, last: { clickId: "unknown-click", utm: { campaign: "none", content: "none", term: "ig_bio" }, referrerHost: null, landingPath: "/", at: NOW } };
    let conversionStatements = 0;
    hooks.batch = (sql) => { conversionStatements += sql.filter((text) => text.includes("INSERT OR IGNORE INTO site_conversions")).length; };
    const conversions = Array.from({ length: 50 }, (_, i) => event(`conversion-${i}`, { t: "conversion", kind: "purchase", value: 1, orderId: `order-${i}` }));
    expect((await collect(env, envelope(conversions, { attr }))).action).toBe("ack");
    expect(conversionStatements).toBe(1); expect(stats().physical).toBeLessThanOrEqual(15); expect(stats().api).toBeLessThanOrEqual(6);
    reset();
    const identities = Array.from({ length: 50 }, (_, i) => event(`identify-${i}`, { t: "identify", emailHash: i.toString(16).padStart(64, "0") }));
    expect((await collect(env, envelope(identities, { sess: "second-session", attr }))).action).toBe("ack");
    expect(stats().physical).toBeLessThanOrEqual(15); expect(stats().api).toBeLessThanOrEqual(6); expect(stats().binds).toBeLessThanOrEqual(100);
  });

  it("같은 봉투 안의 duplicate ID도 한 번만 집계한다", () => {
    const d = sessionDelta(envelope([event("same-event"), event("same-event")]), NOW, new Set()); expect(d?.pageviews).toBe(1);
  });
});
