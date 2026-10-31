import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Auth } from "../types";
import { getDb } from "../db";
import { DEFAULT_GATE } from "../../shared/leads";
import { documentMetrics, type DocumentMetricRow } from "./document-metrics";
import { statsByLink } from "./link-stats";
import { documentRoutes } from "../routes/documents";
import { guideLinkRoutes } from "../routes/links/guide-links";

type Value = string | number | null;
type Row = Record<string, Value>;
type Sqlite = { exec(sql: string): void; close(): void; prepare(sql: string): { run(...params: Value[]): unknown; all(...params: Value[]): Row[] } };
const databases: Sqlite[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

async function setup() {
  const sqlite = await import("node:sqlite" as string) as { DatabaseSync: new (path: string) => Sqlite };
  const fs = await import("node:fs" as string) as { readdirSync(path: string): string[]; readFileSync(path: string, encoding: string): string };
  const db = new sqlite.DatabaseSync(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of fs.readdirSync("migrations").filter((file) => file.endsWith(".sql")).sort()) db.exec(fs.readFileSync(`migrations/${file}`, "utf8"));
  const prepare = (query: string, params: Value[] = []): unknown => ({
    bind: (...values: Value[]) => prepare(query, values),
    run: async () => { db.prepare(query).run(...params); return { success: true, results: [], meta: {} }; },
    all: async () => ({ success: true, results: db.prepare(query).all(...params), meta: {} }),
    raw: async () => db.prepare(query.replace(/^select (.*?) from /i, "select json_array($1) as raw_row from ")).all(...params).map((row) => JSON.parse(String(row.raw_row))),
  });
  const d1 = { prepare } as unknown as D1Database;
  const orm = getDb(d1);
  db.exec("INSERT INTO workspaces (id, name, created_at) VALUES ('w1', '팀', 1), ('w2', '다른 팀', 1)");
  db.exec("INSERT INTO guides (id, workspace_id, name, slug, extra_rules, product, deliverables, secondary_use_scope, created_at, updated_at) VALUES ('g1', 'w1', '캠페인', 'guide', '[]', '{}', '{}', '{}', 1, 1)");
  for (const [id, ws] of [["d1", "w1"], ["d2", "w1"], ["d-other", "w2"]]) {
    db.prepare("INSERT INTO documents (id, workspace_id, guide_id, title, file_key, pages, size_mb, gate, created_at) VALUES (?, ?, ?, ?, '', 1, 0, ?, 1)").run(id!, ws!, ws === "w1" ? "g1" : null, id!, JSON.stringify(DEFAULT_GATE));
  }
  for (const [id, ws, doc] of [["l1", "w1", "d1"], ["l2", "w1", "d1"], ["l-other", "w2", "d-other"]]) {
    db.prepare("INSERT INTO short_links (id, workspace_id, guide_id, channel_key, slug, destination_type, destination_id, utm, og, created_at) VALUES (?, ?, ?, ?, ?, 'document', ?, '{}', '{}', 1)").run(id!, ws!, ws === "w1" ? "g1" : null, id!, id!, doc!);
  }
  const click = (id: string, options: { link?: string; doc?: string | null; at?: number; bot?: boolean; member?: boolean; cookie?: string | null; token?: string | null } = {}) => {
    db.prepare("INSERT INTO link_clicks (id, link_id, at, device, is_bot, is_member, session_id, click_token, destination_type, destination_id) VALUES (?, ?, ?, 'desktop', ?, ?, ?, ?, ?, ?)")
      .run(id, options.link ?? "l1", options.at ?? 100, options.bot ? 1 : 0, options.member ? 1 : 0, options.cookie === undefined ? "browser" : options.cookie, options.token === undefined ? `token-${id}` : options.token, options.doc === null ? null : "document", options.doc === undefined ? "d1" : options.doc);
  };
  const view = (id: string, options: { link?: string | null; doc?: string; click?: string | null; opened?: number | null; cookie?: string | null; member?: boolean } = {}) => {
    db.prepare("INSERT INTO document_views (id, document_id, link_id, session_id, started_at, last_seen_at, opened_at, click_token, is_member) VALUES (?, ?, ?, ?, 100, 100, ?, ?, ?)")
      .run(id, options.doc ?? "d1", options.link === undefined ? "l1" : options.link, options.cookie === undefined ? "browser" : options.cookie, options.opened === undefined ? 110 : options.opened, options.click ? `token-${options.click}` : null, options.member ? 1 : 0);
  };
  const auth = { sessionId: "session", user: { id: "user", email: "test@example.com", name: "테스트" }, phone: null, phoneVerified: true, workspace: { id: "w1", name: "팀", plan: "starter", onboardedAt: 1 }, role: "owner" } as Auth;
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", orm); c.set("auth", auth); await next(); });
  app.route("/api/documents", documentRoutes);
  app.route("/api/guides", guideLinkRoutes);
  app.onError((error, c) => c.text(String(error), 500));
  const call = (path: string) => app.request(path, undefined, { DB: d1, APP_URL: "https://app.example.com", PUBLIC_SHORT_BASE: "https://app.example.com/l" } as Env);
  return { db, orm, click, view, call };
}
const one = (rows: DocumentMetricRow[], key: string | null = null) => rows.find((row) => row.key === key)!;
const counts = (row: Partial<DocumentMetricRow>) => ({ clicks: row.clicks, measuredClicks: row.measuredClicks, views: row.views, uniqueViews: row.uniqueViews, reViews: row.reViews, unattributedViews: row.unattributedViews });

describe("공통 자료 열람 집계", () => {
  it("같은 브라우저의 새 클릭은 고유 클릭으로, 같은 클릭의 재열람은 한 번만 세고 실제 반복은 따로 표시한다", async () => {
    const { orm, click, view } = await setup();
    click("c1"); click("c2");
    view("v1", { click: "c1" }); view("v2", { click: "c1" }); view("v3", { click: "c2" });
    const link = one(await documentMetrics(orm, "w1", { groupBy: "link" }), "l1");
    expect(counts(link)).toEqual({ clicks: 2, measuredClicks: 2, views: 3, uniqueViews: 2, reViews: 2, unattributedViews: 0 });
    expect(link.uniqueViews / link.measuredClicks).toBe(1);
    expect(one(await documentMetrics(orm, "w1", { groupBy: "summary", documentId: "d1" })).uniqueVisitors).toBe(1);
    expect(counts((await statsByLink(orm, "w1")).get("l1")!)).toEqual(counts(link));
  });

  it("직접 방문과 과거 미연결 기록은 보존하고 새 측정 클릭을 추정해서 만들지 않는다", async () => {
    const { orm, click, view } = await setup();
    click("old", { doc: null });
    view("legacy"); view("direct", { link: null, cookie: "direct-browser" });
    const summary = one(await documentMetrics(orm, "w1", { groupBy: "summary", documentId: "d1" }));
    expect(counts(summary)).toEqual({ clicks: 1, measuredClicks: 0, views: 2, uniqueViews: 0, reViews: 0, unattributedViews: 2 });
  });

  it("마이그레이션 뒤 구 Worker INSERT는 기존 시각으로 보존하고 신규 폼 대기와 구별한다", async () => {
    const { db, orm, view } = await setup();
    db.exec("INSERT INTO document_views (id, document_id, link_id, session_id, started_at, last_seen_at, is_member) VALUES ('old-worker', 'd1', 'l1', 'old-browser', 123, 123, 0)");
    view("new-pending", { opened: null });
    view("actual-opened", { opened: 150 });
    expect(db.prepare("SELECT opened_at FROM document_views WHERE id = 'old-worker'").all()[0]?.opened_at).toBe(-1);
    const summary = one(await documentMetrics(orm, "w1", { groupBy: "summary", documentId: "d1", since: 120, until: 130 }));
    expect(summary).toMatchObject({ views: 1, uniqueViews: 0, unattributedViews: 1, measuredClicks: 0 });
    expect(db.prepare("SELECT opened_at FROM document_views WHERE id = 'new-pending'").all()[0]?.opened_at).toBeNull();
    expect(one(await documentMetrics(orm, "w1", { groupBy: "summary", documentId: "d1", since: 140, until: 160 })).views).toBe(1);
    expect(await documentMetrics(orm, "w1", { groupBy: "summary", documentId: "d1", since: 100, until: 110 })).toEqual([]);
  });

  it("다른 링크·워크스페이스·목적지와 봇·구성원·미래 클릭을 분자에 넣지 않는다", async () => {
    const { orm, click, view } = await setup();
    click("valid"); click("other-link", { link: "l2" }); click("other-ws", { link: "l-other", doc: "d-other" });
    click("other-doc", { doc: "d2" }); click("bot", { bot: true }); click("member", { member: true }); click("future", { at: 999 });
    for (const id of ["valid", "other-link", "other-ws", "other-doc", "bot", "member", "future", "unknown"]) view(`v-${id}`, { click: id });
    view("member-view", { click: "valid", member: true });
    const result = one(await documentMetrics(orm, "w1", { groupBy: "link", documentId: "d1" }), "l1");
    expect(result.views).toBe(8);
    expect(result.uniqueViews).toBe(1);
    expect(result.unattributedViews).toBe(7);
    expect(result.measuredClicks).toBe(2);
    expect(result.uniqueViews).toBeLessThanOrEqual(result.measuredClicks);
  });

  it("폼 예약 세션은 실제 열기 전에는 집계하지 않고 같은 v 재개로 수가 늘지 않는다", async () => {
    const { db, orm, click, view } = await setup();
    click("c1"); view("pending", { click: "c1", opened: null });
    expect(one(await documentMetrics(orm, "w1", { groupBy: "summary", documentId: "d1" }))).toMatchObject({ measuredClicks: 1, views: 0, uniqueViews: 0 });
    db.exec("UPDATE document_views SET opened_at = 110 WHERE id = 'pending' AND opened_at IS NULL");
    db.exec("UPDATE document_views SET opened_at = 120 WHERE id = 'pending' AND opened_at IS NULL");
    expect(one(await documentMetrics(orm, "w1", { groupBy: "summary", documentId: "d1" }))).toMatchObject({ measuredClicks: 1, views: 1, uniqueViews: 1, reViews: 0 });
  });

  it("목적지를 변경해도 클릭 당시 문서별 분모와 열람 귀속을 보존한다", async () => {
    const { db, orm, click, view } = await setup();
    click("before");
    db.exec("UPDATE short_links SET destination_id = 'd2' WHERE id = 'l1'");
    click("after", { doc: "d2" });
    view("old-doc", { click: "before" }); view("new-doc", { click: "after", doc: "d2" });
    const documents = await documentMetrics(orm, "w1", { groupBy: "document" });
    for (const id of ["d1", "d2"]) expect(one(documents, id)).toMatchObject({ clicks: 2, measuredClicks: 1, views: 1, uniqueViews: 1 });
    expect(one(await documentMetrics(orm, "w1", { groupBy: "link" }), "l1")).toMatchObject({ measuredClicks: 2, uniqueViews: 2 });
  });

  it("[시작,끝) 기간의 유효 클릭과 실제 열람의 교집합만 전환율에 쓴다", async () => {
    const { orm, click, view } = await setup();
    click("before", { at: 99 }); click("inside", { at: 100 }); click("pending", { at: 190 }); click("after", { at: 200 });
    view("old-click", { click: "before", opened: 110 }); view("in-period", { click: "inside", opened: 150 });
    view("next-period", { click: "pending", opened: 220 }); view("outside", { click: "after", opened: 230 });
    const scope = { since: 100, until: 200, documentId: "d1" };
    const summary = one(await documentMetrics(orm, "w1", { ...scope, groupBy: "summary" }));
    const link = one(await documentMetrics(orm, "w1", { ...scope, groupBy: "link" }), "l1");
    expect(counts(summary)).toEqual(counts(link));
    expect(summary).toMatchObject({ clicks: 2, measuredClicks: 2, uniqueViews: 1, views: 2 });
    expect(summary.uniqueViews / summary.measuredClicks).toBe(0.5);
  });

  it("브라우저 쿠키가 없는 기록은 반복으로 추정하지 않고 서로 다른 문서는 별도로 센다", async () => {
    const { orm, view } = await setup();
    view("anonymous-1", { cookie: null }); view("anonymous-2", { cookie: null });
    view("browser-doc1"); view("browser-doc2", { doc: "d2" });
    const summary = one(await documentMetrics(orm, "w1", { groupBy: "summary" }));
    expect(summary).toMatchObject({ views: 4, uniqueVisitors: 4, reViews: 0, unattributedViews: 4 });
  });

  it("삭제 링크의 기록과 비가산 재열람을 자료·목록·퍼널에서 같은 함수로 집계한다", async () => {
    const { db, orm, click, view, call } = await setup();
    click("c1"); click("c2", { link: "l2" });
    view("v1", { click: "c1" }); view("v2", { click: "c2", link: "l2" });
    db.exec("UPDATE short_links SET deleted_at = 130 WHERE id = 'l1'");
    const byLink = await documentMetrics(orm, "w1", { groupBy: "link" });
    expect(byLink.reduce((sum, row) => sum + row.reViews, 0)).toBe(0);
    const expected = one(await documentMetrics(orm, "w1", { groupBy: "summary", documentId: "d1" }));
    expect(expected).toMatchObject({ clicks: 2, measuredClicks: 2, uniqueViews: 2, reViews: 1 });
    const analyticsResponse = await call("/api/documents/d1/analytics");
    expect(analyticsResponse.status).toBe(200);
    const analytics = await analyticsResponse.json() as DocumentMetricRow & { byLink: { linkId: string }[] };
    expect(analytics.byLink.some((row) => row.linkId === "l1")).toBe(true);
    const listResponse = await call("/api/documents");
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json() as { documents: { id: string; stats: DocumentMetricRow }[] };
    const funnelResponse = await call("/api/guides/g1/funnel");
    expect(funnelResponse.status).toBe(200);
    const funnel = await funnelResponse.json() as { rows: DocumentMetricRow[] };
    expect(counts(analytics)).toEqual(counts(expected));
    expect(counts(list.documents.find((doc) => doc.id === "d1")!.stats)).toEqual(counts(expected));
    expect(counts(funnel.rows[0]!)).toEqual(counts(expected));
  });
});
