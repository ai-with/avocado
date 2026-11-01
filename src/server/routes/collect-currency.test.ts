import { afterEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { getDb } from "../db";
import type { AppEnv } from "../types";
import { collectRoutes } from "./collect";
import { createSqliteD1, type TestSqlite } from "../test/sqlite-d1";
import { loadCollectMessage } from "../lib/collect/intake";
const databases: TestSqlite[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
it("HTTP 시점의 site currency만 생략 conversion에 고정하고 명시 currency/다른 이벤트를 보존한다", async () => {
  const { db, d1 } = await createSqliteD1(); databases.push(db);
  db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w','Currency',1)");
  db.exec(`INSERT INTO sites(id,workspace_id,site_key,name,allowed_domains,currency,created_at) VALUES('s','w','site_test','Shop','["shop.example.com"]','USD',1)`);
  const send = vi.fn(), app = new Hono<AppEnv>(); app.use("*", async (c, next) => { c.set("db", getDb(c.env.DB)); await next(); }); app.route("/collect", collectRoutes);
  const base = { ts: 1_000, url: "https://shop.example.com/p", ref: null };
  const explicit = { ...base, id: "event_000002", t: "conversion", kind: "purchase", value: 2, currency: "EUR" };
  const page = { ...base, id: "event_000003", t: "pageview", title: "Shop" };
  const body = { v: 1, sdk: "1.1.0", site: "site_test", anon: "anon_00000001", sess: "sess_00000001", consent: "granted", attr: { first: null, last: null }, screen: { w: 1, h: 1, dpr: 1 }, sentAt: 2_000,
    events: [{ ...base, id: "event_000001", t: "conversion", kind: "purchase", value: 10 }, explicit, page] };
  const response = await app.request("https://app.test/collect", { method: "POST", headers: { Origin: "https://shop.example.com", "User-Agent": "Mozilla/5.0 Chrome/130" }, body: JSON.stringify(body) }, { DB: d1, TOKEN_ENC_KEY: "currency-test-key", COLLECT: { send } } as unknown as Env);
  expect(response.status).toBe(204); expect(send).toHaveBeenCalledTimes(1);
  db.exec("UPDATE sites SET currency='KRW'");
  expect(Object.keys(send.mock.calls[0]![0].payload)).toEqual(["id"]);
  const accepted = (await loadCollectMessage({ DB: d1, TOKEN_ENC_KEY: "currency-test-key" } as Env, send.mock.calls[0]![0].payload))!;
  expect(accepted.envelope.events[0]).toMatchObject({ t: "conversion", value: 10, currency: "USD" });
  expect(accepted.envelope.events[1]).toEqual(explicit); expect(accepted.envelope.events[2]).toEqual(page);
  expect(body.events[0]).not.toHaveProperty("currency");
});
