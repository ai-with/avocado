import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, type TestSqlite } from "../test/sqlite-d1";
import { getDb } from "../db";
import { conversionTotals, ECB_RATES_URL, enqueueFxRefresh, parseEcbRates, refreshFxRates } from "./site-fx";
import { summaries } from "../routes/sites/shared";

const NOW = Date.parse("2026-11-01T02:00:00Z"), DAY = 86_400_000, HOUR = 3_600_000;
const databases: TestSqlite[] = [];
const xml = (body = '<Cube time="2026-10-30"><Cube currency="USD" rate="2"/><Cube currency="KRW" rate="1000"/></Cube>') => `<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube>${body}</Cube></gesmes:Envelope>`;
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.spyOn(console, "warn").mockImplementation(() => {}); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected external request"); })); });
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup() {
  const { db, d1 } = await createSqliteD1(); databases.push(db);
  db.exec(`INSERT INTO workspaces(id,name,created_at) VALUES ('w1','QA',1),('w2','Other',1);
    INSERT INTO sites(id,workspace_id,site_key,name,allowed_domains,currency,created_at) VALUES ('s1','w1','site_one','QA','[]','KRW',1),('s2','w2','site_two','Other','[]','KRW',1);
    INSERT INTO site_sessions(site_id,id,anon_id,first_at,last_at,is_member) VALUES ('s1','visitor','anon',1,1,0),('s1','member','staff',1,1,1),('s2','other','other',1,1,0);`);
  const conversion = (id: string, currency: string, value: number | null, at = NOW, received = NOW, site = "s1", session = "visitor") => {
    db.prepare("INSERT INTO site_conversions(id,site_id,session_id,kind,value,currency,at,received_at) VALUES (?,?,?,'purchase',?,?,?,?)").run(id, site, session, value, currency, at, received);
  };
  const rate = (day = "2026-10-30", rates: Record<string, number> = { EUR: 1, USD: 2, KRW: 1000 }) => db.prepare("INSERT INTO site_fx_rates(day,rates,fetched_at) VALUES (?,?,?)").run(day, JSON.stringify(rates), NOW);
  const send = vi.fn(async () => {});
  const env = { DB: d1, PIPELINE: { sendBatch: send } } as unknown as Env;
  return { db, d1, env, send, conversion, rate, orm: getDb(d1) };
}

describe("ECB reference document validation", () => {
  it("parses EUR-base days without changing units and handles a weekend", () => {
    expect(parseEcbRates(xml(), NOW)).toEqual([{ day: "2026-10-30", rates: { EUR: 1, USD: 2, KRW: 1000 } }]);
  });
  it.each([
    "<!DOCTYPE a><gesmes:Envelope></gesmes:Envelope>", xml().replace("rate=\"2\"", "rate=\"0\""), xml().replace("rate=\"2\"", "rate=\"NaN\""),
    xml().replace("USD", "usd"), xml().replace("2026-10-30", "2026-02-30"), xml().replace("2026-10-30", "2026-12-01"),
    xml().replace("2026-10-30", "2020-01-01"), xml().replace("</gesmes:Envelope>", ""),
    xml().replace('<Cube currency="USD" rate="2"/>', '<Cube currency="USD" rate="2"/><Cube currency="USD" rate="3"/>'),
    xml().replace('currency="USD"', 'currency="EUR"'), xml().replace("1000", "&secret;"), "x".repeat(256 * 1024 + 1),
    xml().slice(xml().indexOf("<Cube>")), xml().replace("<Cube>", "<Cube><unexpected/>"),
    xml().replace('xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01"', 'xmlns:gesmes="other"'),
  ])("rejects malformed, stale, duplicate or unsupported metadata", (document) => {
    expect(() => parseEcbRates(document, NOW)).toThrow();
  });
});

describe("Same-cohort multi-currency totals", () => {
  it("converts foreign values and recomputes consistently when the site's base changes", async () => {
    const { conversion, rate, orm, db } = await setup(); rate();
    conversion("usd", "USD", 10); conversion("native", "KRW", 5); conversion("unpriced", "JPY", 100); conversion("empty", "USD", null);
    conversion("staff", "USD", 10000, NOW, NOW, "s1", "member"); conversion("other", "USD", 10000, NOW, NOW, "s2", "other");
    expect(await conversionTotals(orm, [{ id: "s1", currency: "KRW" }], "2026-10-31")).toEqual([{ siteId: "s1", value: 5005, pending: 1, converted: 1 }]);
    db.exec("UPDATE sites SET currency='USD' WHERE id='s1'");
    expect(await conversionTotals(orm, [{ id: "s1", currency: "USD" }], "2026-10-31")).toEqual([{ siteId: "s1", value: 10.01, pending: 1, converted: 1 }]);
    db.exec("UPDATE sites SET deleted_at=1 WHERE id='s1'"); expect(await conversionTotals(orm, [{ id: "s1", currency: "KRW" }], "2026-10-31")).toEqual([]);
  });

  it("uses receipt time for inclusion, event date for rate, and never uses future/stale quotes", async () => {
    const { conversion, rate, orm } = await setup(); rate();
    conversion("included", "USD", 10, NOW - DAY, NOW); conversion("old-receipt", "USD", 100, NOW, NOW - 2 * DAY);
    conversion("before-quote", "USD", 5, Date.parse("2026-10-29T00:00:00Z")); conversion("stale", "USD", 7, NOW - 20 * DAY);
    expect(await conversionTotals(orm, [{ id: "s1", currency: "KRW" }], "2026-10-31")).toEqual([{ siteId: "s1", value: 5000, pending: 2, converted: 1 }]);
  });

  it("shows missing rate coverage and leaves zero-valued foreign conversions pending too", async () => {
    const { conversion, orm } = await setup(); conversion("native", "KRW", 3); conversion("zero", "USD", 0);
    expect(await conversionTotals(orm, [{ id: "s1", currency: "KRW" }], "2026-10-31")).toEqual([{ siteId: "s1", value: 3, pending: 1, converted: 0 }]);
  });

  it("does not use the old mixed-unit cached sum and preserves the KST receipt boundary", async () => {
    const { conversion, rate, orm, db } = await setup(); rate();
    const since = Date.parse("2026-10-26T00:00:00+09:00");
    conversion("boundary", "KRW", 7, NOW, since); conversion("excluded", "KRW", 100, NOW, since - 1);
    db.exec("INSERT INTO site_daily_stats(site_id,day,link_id,sessions,pageviews,conversions,conversion_value) VALUES ('s1','2026-11-01','',1,2,1,999999)");
    expect((await summaries(orm, [{ id: "s1", currency: "KRW" }])).get("s1")).toMatchObject({ sessions: 1, pageviews: 2, conversions: 1, conversionValue: 7, conversionValuePending: 0 });
  });

  it("keeps non-finite totals representable with explicit pending coverage", async () => {
    const { conversion, orm } = await setup(); conversion("large1", "KRW", 1e308); conversion("large2", "KRW", 1e308);
    expect(await conversionTotals(orm, [{ id: "s1", currency: "KRW" }], "2026-10-31")).toEqual([{ siteId: "s1", value: 0, pending: 2, converted: 0 }]);
  });

  it("aggregates source amounts before conversion to avoid artificial opposing infinities", async () => {
    const { conversion, rate, orm } = await setup(); rate(); conversion("positive", "USD", 1e308); conversion("negative", "USD", -1e308);
    expect(await conversionTotals(orm, [{ id: "s1", currency: "KRW" }], "2026-10-31")).toEqual([{ siteId: "s1", value: 0, pending: 0, converted: 2 }]);
  });

  it("avoids overflowing an intermediate value when the actual converted amount is finite", async () => {
    const { conversion, rate, orm } = await setup(); rate("2026-10-30", { EUR: 1, CHF: 0.94, GBP: 0.83 }); conversion("large", "CHF", 1.7e308);
    const [total] = await conversionTotals(orm, [{ id: "s1", currency: "GBP" }], "2026-10-31");
    expect(total?.value).toBe(1.7e308 * (0.83 / 0.94)); expect(total).toMatchObject({ pending: 0, converted: 1 });
  });

  it("keeps the request's currency snapshot even when a concurrent settings update changes the database", async () => {
    const { conversion, rate, orm, db } = await setup(); rate(); conversion("usd", "USD", 10);
    const snapshot = [{ id: "s1", currency: "KRW" }];
    db.exec("UPDATE sites SET currency='USD' WHERE id='s1'");
    expect((await summaries(orm, snapshot)).get("s1")).toMatchObject({ conversionValue: 5000 });
    expect((await summaries(orm, [{ id: "s1", currency: "USD" }])).get("s1")).toMatchObject({ conversionValue: 10 });
  });

  it("keeps capture-time membership and anonymous amounts after raw person data is purged", async () => {
    const { conversion, rate, orm, db } = await setup(); rate(); conversion("usd", "USD", 10);
    db.exec("INSERT INTO site_daily_stats(site_id,day,link_id,sessions,conversions) VALUES ('s1','2026-11-01','',1,1)");
    db.exec("UPDATE site_sessions SET is_member=1 WHERE site_id='s1' AND id='visitor'");
    expect((await summaries(orm, [{ id: "s1", currency: "KRW" }])).get("s1")).toMatchObject({ conversions: 1, conversionValue: 5000, conversionValuePending: 0 });
    db.exec("DELETE FROM site_conversions; DELETE FROM site_sessions");
    expect((await summaries(orm, [{ id: "s1", currency: "KRW" }])).get("s1")).toMatchObject({ conversions: 1, conversionValue: 5000, conversionValuePending: 0 });
    db.exec("DELETE FROM sites WHERE id='s1'"); expect(db.prepare("SELECT count(*) AS n FROM site_currency_totals").all()).toEqual([{ n: 0 }]);
  });

  it("does not count a duplicate order twice in the anonymous currency sum", async () => {
    const { conversion, rate, orm, db } = await setup(); rate(); conversion("first", "USD", 10);
    db.exec("UPDATE site_conversions SET order_id='same' WHERE id='first'");
    db.prepare("INSERT OR IGNORE INTO site_conversions(id,site_id,session_id,kind,value,currency,at,received_at,order_id) VALUES ('duplicate','s1','visitor','purchase',999,'USD',?,?,'same')").run(NOW, NOW);
    expect(await conversionTotals(orm, [{ id: "s1", currency: "KRW" }], "2026-10-31")).toEqual([{ siteId: "s1", value: 5000, pending: 0, converted: 1 }]);
  });

  it("rolls back anonymous sums with their source transaction", async () => {
    const { db, d1 } = await setup();
    await expect(d1.batch([
      d1.prepare("INSERT INTO site_conversions(id,site_id,session_id,kind,value,currency,at,received_at) VALUES ('rollback','s1','visitor','purchase',10,'USD',?,?)").bind(NOW, NOW),
      d1.prepare("SELECT json('[')"),
    ])).rejects.toThrow();
    expect(db.prepare("SELECT count(*) AS n FROM site_currency_totals").all()).toEqual([{ n: 0 }]);
  });

  it("uses the same captured eligibility as daily stats when another collector changes membership first", async () => {
    const { db, rate, orm } = await setup(); rate();
    const capturedEligible = 1; // Collector A's snapshot, also used for its daily increment.
    db.exec("UPDATE site_sessions SET is_member=1 WHERE site_id='s1' AND id='visitor'"); // Collector B wins first.
    db.prepare("INSERT INTO site_conversions(id,site_id,session_id,kind,value,currency,at,received_at,eligible_at_capture) VALUES ('raced','s1','visitor','purchase',10,'USD',?,?,?)").run(NOW, NOW, capturedEligible);
    db.exec("INSERT INTO site_daily_stats(site_id,day,link_id,conversions) VALUES ('s1','2026-11-01','',1)");
    expect((await summaries(orm, [{ id: "s1", currency: "KRW" }])).get("s1")).toMatchObject({ conversions: 1, conversionValue: 5000, conversionValuePending: 0 });
  });

  it("migrates surviving raw data and marks already-purged legacy amounts as unknown", async () => {
    const { db, d1 } = await createSqliteD1({ migrateThrough: 27 }); databases.push(db);
    db.exec(`INSERT INTO workspaces(id,name,created_at) VALUES ('w','QA',1);
      INSERT INTO sites(id,workspace_id,site_key,name,allowed_domains,currency,created_at) VALUES ('s','w','site_legacy','QA','[]','KRW',1);
      INSERT INTO site_sessions(site_id,id,anon_id,first_at,last_at) VALUES ('s','sess','anon',1,1);
      INSERT INTO site_daily_stats(site_id,day,link_id,conversions,conversion_value) VALUES ('s','2026-11-01','',3,999);
      INSERT INTO site_conversions(id,site_id,session_id,kind,value,currency,at) VALUES ('known','s','sess','purchase',10,'USD',${NOW});`);
    const fs = await import("node:fs" as string) as { readFileSync(path: string, encoding: string): string };
    db.exec(fs.readFileSync("migrations/0029_site_fx.sql", "utf8"));
    db.prepare("INSERT INTO site_fx_rates(day,rates,fetched_at) VALUES ('2026-10-30',?,?)").run(JSON.stringify({ EUR: 1, USD: 2, KRW: 1000 }), NOW);
    expect(await conversionTotals(getDb(d1), [{ id: "s", currency: "KRW" }], "2026-10-31")).toEqual([{ siteId: "s", value: 5000, pending: 2, converted: 1 }]);
  });
});

describe("Bounded global refresh Queue", () => {
  it("enqueues once and restores the enqueue claim after an unavailable Queue", async () => {
    const { env, send, db } = await setup(); send.mockRejectedValueOnce(new Error("unavailable"));
    await expect(enqueueFxRefresh(env)).rejects.toThrow("fx_enqueue_failed");
    expect(db.prepare("SELECT next_enqueue_at FROM site_fx_refresh").all()[0]).toEqual({ next_enqueue_at: NOW });
    await enqueueFxRefresh(env); await enqueueFxRefresh(env); expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith([{ body: { type: "site_fx_refresh", payload: {} } }]);
  });

  it("claims one consumer, writes rates atomically, and makes no further HTTP within twelve hours", async () => {
    const { env, db } = await setup(); const fetcher = vi.fn(async () => new Response(xml())); vi.stubGlobal("fetch", fetcher);
    await Promise.all([refreshFxRates({}, env), refreshFxRates({}, env)]);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0]).toEqual([ECB_RATES_URL, expect.objectContaining({ redirect: "manual" })]);
    expect(db.prepare("SELECT day,json_extract(rates,'$.KRW') AS krw FROM site_fx_rates").all()).toEqual([{ day: "2026-10-30", krw: 1000 }]);
    expect(db.prepare("SELECT last_success_at,lease_until FROM site_fx_refresh").all()[0]).toEqual({ last_success_at: NOW, lease_until: 0 });
    await refreshFxRates({}, env); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["redirect", "invalid", "network", "oversize", "streamOversize"])("keeps prior rates and durable backoff on %s", async (failure) => {
    const { env, db, rate } = await setup(); rate();
    const fetcher = vi.fn(async () => {
      if (failure === "network") throw new Error("raw internal diagnostic");
      if (failure === "redirect") return new Response("secret body", { status: 302, headers: { Location: "https://untrusted.example/" } });
      if (failure === "oversize") return new Response(xml(), { headers: { "Content-Length": "262145" } });
      if (failure === "streamOversize") return new Response("x".repeat(262145));
      return new Response("bad xml");
    }); vi.stubGlobal("fetch", fetcher);
    await refreshFxRates({}, env); await refreshFxRates({}, env);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(db.prepare("SELECT count(*) AS n FROM site_fx_rates").all()[0]).toEqual({ n: 1 });
    expect(db.prepare("SELECT next_attempt_at,lease_until,last_success_at FROM site_fx_refresh").all()[0]).toEqual({ next_attempt_at: NOW + HOUR, lease_until: 0, last_success_at: 0 });
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("[fx] reference_rates_unavailable");
  });
});
