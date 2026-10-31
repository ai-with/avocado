import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { getDb } from "../db";
import { ApiError, errorBody } from "./errors";
import { newToken, sha256Hex } from "./ids";
import { DEFAULT_GATE } from "../../shared/leads";
import { documentClickToken } from "./doc-attribution";
import { loadSession } from "../middleware/auth";
import { shortLinkRedirect } from "../routes/public-lead/redirect";
import { publicDocRoutes } from "../routes/public-lead/docs";
import { publicDocVerifyRoutes } from "../routes/public-lead/doc-verify";
import { publicFormRoutes } from "../routes/public-lead/forms";

type Value = string | number | null;
type Row = Record<string, Value>;
type Sqlite = { exec(sql: string): void; close(): void; prepare(sql: string): { run(...params: Value[]): { changes: number }; all(...params: Value[]): Row[] } };
const databases: Sqlite[] = [];
const NOW = Date.parse("2026-10-31T06:00:00Z");
const HUMAN = "Mozilla/5.0";
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("외부 요청 금지"); }));
});
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(legacy = false) {
  const sqlite = await import("node:sqlite" as string) as { DatabaseSync: new (path: string) => Sqlite };
  const fs = await import("node:fs" as string) as { readdirSync(path: string): string[]; readFileSync(path: string, encoding: string): string };
  const db = new sqlite.DatabaseSync(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys = ON");
  const files = fs.readdirSync("migrations").filter((file) => file.endsWith(".sql")).sort();
  for (const file of files.filter((file) => !legacy || file < "0023_document_attribution.sql")) db.exec(fs.readFileSync(`migrations/${file}`, "utf8"));
  const prepare = (sql: string, params: Value[] = []): unknown => ({
    bind: (...values: Value[]) => prepare(sql, values),
    run: async () => ({ success: true, results: [], meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
    all: async () => ({ success: true, results: db.prepare(sql).all(...params), meta: {} }),
    raw: async () => /^select /i.test(sql)
      ? db.prepare(sql.replace(/^select (.*?) from /i, "select json_array($1) as raw_row from ")).all(...params).map((row) => JSON.parse(String(row.raw_row)))
      : db.prepare(sql).all(...params).map((row) => Object.values(row)),
  });
  const d1 = { prepare, batch: async (statements: { run(): Promise<unknown> }[]) => {
    db.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      db.exec("COMMIT");
      return results;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
  db.exec("INSERT INTO workspaces (id, name, created_at) VALUES ('w1', '첫 팀', 1), ('w2', '다른 팀', 1)");
  const doc = db.prepare("INSERT INTO documents (id, workspace_id, title, file_key, pages, size_mb, gate, source_type, content_html, created_at) VALUES (?, ?, ?, '', 1, 0, ?, 'editor', '<p>본문</p>', 1)");
  for (const [id, ws] of [["d1", "w1"], ["d2", "w1"], ["d-other", "w2"]]) doc.run(id!, ws!, id!, JSON.stringify(DEFAULT_GATE));
  db.prepare("INSERT INTO forms (id, workspace_id, title, fields, after_submit, created_at) VALUES ('f1', 'w1', '신청', ?, ?, 1)")
    .run(JSON.stringify({ base: [], questions: [] }), JSON.stringify({ type: "document", documentId: "d1", text: "자료를 열어 주세요." }));
  const link = db.prepare("INSERT INTO short_links (id, workspace_id, channel_key, slug, destination_type, destination_id, utm, og, created_at) VALUES (?, ?, 'ig_bio', ?, ?, ?, '{}', '{}', 1)");
  for (const [id, ws, type, dest] of [["l1", "w1", "document", "d1"], ["l2", "w1", "document", "d1"], ["lf", "w1", "form", "f1"], ["l-other", "w2", "document", "d-other"]]) link.run(id!, ws!, id!, type!, dest!);
  const env = { DB: d1, APP_URL: "https://app.example.com", APP_ENV: "production", TOKEN_ENC_KEY: "test-unlock-key" } as Env;
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", getDb(c.env.DB)); await next(); });
  app.use("*", loadSession);
  app.route("/l", shortLinkRedirect);
  app.route("/api/public", publicDocRoutes);
  app.route("/api/public", publicDocVerifyRoutes);
  app.route("/api/public", publicFormRoutes);
  app.onError((error, c) => error instanceof ApiError ? c.json(errorBody(error.code, error.message), error.status) : c.text(String(error), 500));
  const call = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { "user-agent": HUMAN, ...init.headers } }, env);
  const click = async (slug = "l1", cookie = "lv=visitor-cookie", ua = HUMAN) => {
    const response = await call(`/l/${slug}`, { headers: { cookie, "user-agent": ua } });
    expect(response.status).toBe(302);
    return new URL(response.headers.get("location")!, env.APP_URL).searchParams.get("avc");
  };
  const read = async (slug = "l1", token?: string | null, cookie = "lv=visitor-cookie", more = "") => {
    const response = await call(`/api/public/doc/${slug}?${token ? `avc=${token}&` : ""}${more}`, { headers: { cookie } });
    expect(response.status).toBe(200);
    return await response.json() as { viewToken: string };
  };
  return { db, orm: getDb(d1), call, click, read, migrate: () => db.exec(fs.readFileSync("migrations/0023_document_attribution.sql", "utf8")) };
}
const post = (body: unknown, cookie = "lv=visitor-cookie"): RequestInit => ({ method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const view = (db: Sqlite, id: string) => db.prepare("SELECT * FROM document_views WHERE id = ?").all(id)[0]!;
const views = (db: Sqlite) => db.prepare("SELECT * FROM document_views").all();

describe("자료 클릭 출처 저장", () => {
  it("마이그레이션은 과거 열람을 보존하고 클릭 연결이나 목적지는 추측하지 않는다", async () => {
    const { db, migrate } = await setup(true);
    db.exec("INSERT INTO link_clicks (id, link_id, at, device, is_bot, is_member, session_id, click_token) VALUES ('old-click', 'l1', 1, 'desktop', 0, 0, 'visitor-cookie', 'old-click-token1')");
    db.exec("INSERT INTO document_views (id, document_id, link_id, session_id, started_at, last_seen_at, is_member) VALUES ('old-view', 'd1', 'l1', 'visitor-cookie', 123, 123, 0)");
    migrate();
    expect(view(db, "old-view")).toMatchObject({ opened_at: -1, started_at: 123, click_token: null });
    expect(db.prepare("SELECT destination_type, destination_id FROM link_clicks").all()).toEqual([{ destination_type: null, destination_id: null }]);
  });

  it("구 Worker가 컬럼 없이 만든 열람을 같은 v로 재개해도 과거 시각과 legacy 표시를 보존한다", async () => {
    const { db, read } = await setup();
    db.exec("INSERT INTO document_views (id, document_id, link_id, session_id, started_at, last_seen_at, is_member) VALUES ('rollout-view', 'd1', 'l1', 'visitor-cookie', 123, 123, 0)");
    const original = view(db, "rollout-view");
    expect(original).toMatchObject({ opened_at: -1, started_at: 123, click_token: null });
    const resumed = await read("l1", null, "lv=visitor-cookie", "v=rollout-view");
    expect(resumed.viewToken).toBe("rollout-view");
    await read("l1", null, "lv=visitor-cookie", "v=rollout-view");
    expect(views(db)).toHaveLength(1);
    expect(view(db, "rollout-view")).toEqual(original);
    expect(db.prepare("SELECT * FROM events WHERE name = 'document_viewed'").all()).toHaveLength(0);
  });

  it("내부 자료 redirect에 실제 클릭 ID를 넘기고 같은 클릭의 새 열람에는 같은 ID를 저장한다", async () => {
    const { db, click, read } = await setup();
    const token = await click();
    expect(token).toMatch(/^[\w-]{16}$/);
    const first = await read("l1", token);
    const second = await read("l1", token);
    expect(first.viewToken).not.toBe(second.viewToken);
    expect(views(db)).toHaveLength(2);
    expect(views(db).map((row) => row.click_token)).toEqual([token, token]);
    expect(view(db, first.viewToken).opened_at).toBe(NOW);
    expect(db.prepare("SELECT destination_type, destination_id FROM link_clicks").all()).toEqual([{ destination_type: "document", destination_id: "d1" }]);
    const thirdToken = await click();
    await read("l1", thirdToken);
    expect(thirdToken).not.toBe(token);
    expect(views(db).map((row) => row.session_id)).toEqual(["visitor-cookie", "visitor-cookie", "visitor-cookie"]);
  });

  it("직접 방문·위조·다른 링크·다른 워크스페이스의 avc를 추정 연결하지 않는다", async () => {
    const { db, click, read } = await setup();
    const sameLink = await click();
    const otherWorkspace = await click("l-other");
    for (const [slug, token] of [["l1", null], ["l1", "not-a-real-token"], ["l2", sameLink], ["l1", otherWorkspace]] as const) await read(slug, token);
    expect(views(db)).toHaveLength(4);
    expect(views(db).every((row) => row.click_token === null)).toBe(true);
  });

  it("봇·구성원 클릭과 과거 클릭은 자료 전환에 연결하지 않는다", async () => {
    const { db, orm, click, read, call } = await setup();
    expect(await click("l1", "", "ExampleBot")).toBeNull();
    db.prepare("INSERT INTO users (id, email, password_hash, name, created_at, phone_verified_at) VALUES ('u1', 'member@example.com', '', '구성원', 1, 1)").run();
    db.exec("INSERT INTO members (workspace_id, user_id, role, created_at) VALUES ('w1', 'u1', 'owner', 1)");
    const sid = newToken();
    db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, 'u1', ?, 1)").run(await sha256Hex(sid), NOW + 60_000);
    const memberToken = await click("l1", `sid=${sid}; lv=member-cookie`);
    await read("l1", memberToken, `sid=${sid}; lv=member-cookie`);
    expect(views(db)[0]).toMatchObject({ is_member: 1, click_token: null });
    const tokens = ["bot-click-token1", "old-click-token1"];
    for (const [index, token] of tokens.entries()) db.prepare("INSERT INTO link_clicks (id, link_id, at, device, is_bot, is_member, click_token, destination_type, destination_id) VALUES (?, 'l1', 1, 'desktop', ?, 0, ?, ?, ?)")
      .run(`seed-${index}`, index === 0 ? 1 : 0, token!, index === 0 ? "document" : null, index === 0 ? "d1" : null);
    for (const token of tokens) expect(await documentClickToken(orm, { id: "l1", workspaceId: "w1" }, "d1", token, false)).toBeNull();
    const valid = await click();
    const botResponse = await call(`/api/public/doc/l1?avc=${valid}`, { headers: { "user-agent": "ExampleBot" } });
    const botView = await botResponse.json() as { viewToken: string };
    expect(view(db, botView.viewToken).click_token).toBeNull();
  });

  it("클릭 당시 목적지는 링크를 다른 자료로 바꿔도 유지한다", async () => {
    const { db, click, read } = await setup();
    const oldToken = await click();
    db.exec("UPDATE short_links SET destination_id = 'd2' WHERE id = 'l1'");
    const afterChange = await read("l1", oldToken);
    expect(view(db, afterChange.viewToken)).toMatchObject({ document_id: "d2", click_token: null });
    const nextToken = await click();
    const next = await read("l1", nextToken);
    expect(view(db, next.viewToken).click_token).toBe(nextToken);
    expect(db.prepare("SELECT destination_id FROM link_clicks ORDER BY rowid").all()).toEqual([{ destination_id: "d1" }, { destination_id: "d2" }]);
  });

  it("동일 v의 게이트·메일 인증 재개는 새 열람을 만들지 않고 원래 클릭을 유지한다", async () => {
    const { db, click, read, call } = await setup();
    const token = await click();
    const first = await read("l1", token);
    const gate = await call("/api/public/doc/l1/gate", post({ viewToken: first.viewToken, email: "lead@example.com", name: "리드", privacyAgreed: true }));
    expect(gate.status).toBe(200);
    const gateResult = await gate.json() as { unlockToken: string };
    await read("l1", null, "lv=visitor-cookie", `v=${first.viewToken}&t=${encodeURIComponent(gateResult.unlockToken)}`);
    db.prepare("INSERT INTO doc_verify_tokens (token_hash, document_id, view_id, lead_id, expires_at, created_at) VALUES (?, 'd1', ?, ?, ?, ?)")
      .run(await sha256Hex("verify-token"), first.viewToken, view(db, first.viewToken).lead_id!, NOW + 60_000, NOW);
    const verified = await call("/api/public/doc/l1/verify", post({ token: "verify-token" }));
    expect(verified.status).toBe(200);
    const verifiedResult = await verified.json() as { viewToken: string; unlockToken: string };
    expect(verifiedResult.viewToken).toBe(first.viewToken);
    await read("l1", null, "lv=visitor-cookie", `v=${verifiedResult.viewToken}&t=${encodeURIComponent(verifiedResult.unlockToken)}`);
    expect(views(db)).toHaveLength(1);
    expect(view(db, first.viewToken)).toMatchObject({ click_token: token, opened_at: NOW });
    expect(db.prepare("SELECT * FROM events WHERE name = 'document_viewed'").all()).toHaveLength(1);
  });

  it("다른 링크에서 받은 v로 원래 링크 출처를 재사용하지 않는다", async () => {
    const { db, click, read, call } = await setup();
    const first = await read("l1", await click());
    const other = await read("l2", null, "lv=visitor-cookie", `v=${first.viewToken}`);
    expect(other.viewToken).not.toBe(first.viewToken);
    expect(view(db, first.viewToken).link_id).toBe("l1");
    expect(view(db, other.viewToken)).toMatchObject({ link_id: "l2", click_token: null });
    const gate = await call("/api/public/doc/l2/gate", post({ viewToken: first.viewToken, email: "lead@example.com", name: "리드", privacyAgreed: true }));
    expect(gate.status).toBe(403);
    expect(view(db, first.viewToken).lead_id).toBeNull();
    const events = await call("/api/public/doc/l2/events", post({ viewToken: first.viewToken, pages: [], maxPage: 1, maxScrollPct: 100, completed: true }));
    expect(events.status).toBe(403);
    expect(view(db, first.viewToken).completed).toBe(0);
  });
});

describe("신청 폼 뒤 자료 열기", () => {
  it("폼의 avc를 예약 행에 보존하고 실제 자료 GET에서 한 번만 열람으로 전환한다", async () => {
    const { db, click, call } = await setup();
    const token = await click("lf");
    const submitted = await call(`/api/public/form/lf/submit?avc=${token}`, post({ email: "lead@example.com", privacyAgreed: true }));
    expect(submitted.status).toBe(200);
    const result = await submitted.json() as { url: string };
    const url = new URL(result.url, "https://app.example.com");
    const viewToken = url.searchParams.get("v")!;
    expect(view(db, viewToken)).toMatchObject({ document_id: "d1", click_token: token, opened_at: null });
    expect(db.prepare("SELECT * FROM document_views WHERE opened_at IS NOT NULL").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM events WHERE name = 'document_viewed'").all()).toHaveLength(0);
    const read = () => call(`/api/public/doc/lf?v=${viewToken}`, { headers: { cookie: "lv=visitor-cookie" } });
    expect((await read()).status).toBe(200);
    expect((await read()).status).toBe(200);
    expect(views(db)).toHaveLength(1);
    expect(view(db, viewToken)).toMatchObject({ click_token: token, opened_at: NOW });
    expect(db.prepare("SELECT * FROM events WHERE name = 'document_viewed'").all()).toHaveLength(1);
    expect(db.prepare("SELECT destination_type, destination_id FROM link_clicks").all()).toEqual([{ destination_type: "document", destination_id: "d1" }]);
  });

  it("폼 연결 자료 변경 후의 열람을 예전 자료 클릭으로 연결하지 않는다", async () => {
    const { db, click, call } = await setup();
    const token = await click("lf");
    db.prepare("UPDATE forms SET after_submit = ? WHERE id = 'f1'").run(JSON.stringify({ type: "document", documentId: "d2", text: "바뀐 자료" }));
    const submitted = await call(`/api/public/form/lf/submit?avc=${token}`, post({ email: "lead@example.com", privacyAgreed: true }));
    expect(submitted.status).toBe(200);
    expect(views(db)[0]).toMatchObject({ document_id: "d2", click_token: null, opened_at: null });
    expect(db.prepare("SELECT destination_id FROM link_clicks").all()).toEqual([{ destination_id: "d1" }]);
  });
});
