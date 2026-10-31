import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db";
import { ApiError, errorBody } from "../../lib/errors";
import { createSqliteD1, type TestSqlite } from "../../test/sqlite-d1";
import { publicLeadRoutes } from "./index";

const NOW = 1_800_000_000_000, databases: TestSqlite[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External HTTP is forbidden"); })); });
afterEach(() => { databases.splice(0).forEach((db) => db.close()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup() {
  const { db, d1: native } = await createSqliteD1(); databases.push(db);
  let beforeUpdate: (() => Promise<void>) | undefined;
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => new Proxy(statement, { get(target, key) {
    if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values), sql);
    if (["run", "all", "raw"].includes(String(key))) return async (...values: unknown[]) => {
      if (/^update "leads"/i.test(sql) && beforeUpdate) { const hook = beforeUpdate; beforeUpdate = undefined; await hook(); }
      return Reflect.get(target, key).apply(target, values);
    };
    return Reflect.get(target, key);
  } });
  const d1 = { ...native, prepare: (sql: string) => wrap(native.prepare(sql), sql) } as D1Database;
  db.exec("INSERT INTO workspaces(id,name,sender_name,sender_contact,created_at) VALUES('private-workspace-one','정확한 브랜드','Private sender','010-private',1),('private-workspace-two','다른 브랜드','Other sender','other@example.com',1); INSERT INTO brands(id,workspace_id,name,created_at) VALUES('brand','private-workspace-one','다른 브랜드 테이블 이름',1)");
  for (const [id, workspace, token] of [["private-lead-one", "private-workspace-one", "capability-one"], ["private-lead-two", "private-workspace-two", "capability-two"]]) {
    db.prepare("INSERT INTO leads(id,workspace_id,email,name,phone,answers,marketing_opt_in,alimtalk_opt_in,unsubscribe_token,first_source,last_source,created_at) VALUES(?,?,?,'Private recipient','010-recipient','{}',1,1,?,'{}','{}',1)").run(id!, workspace!, "same-private@example.com", token!);
  }
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", getDb(c.env.DB)); c.set("auth", { sessionId: "private-session", user: { id: "private-user", email: "private-user@example.com", name: "Private user" }, workspace: { id: "private-workspace-two", name: "다른 브랜드", plan: "starter", onboardedAt: 1, onboardingSkippedAt: null }, role: "owner", phone: null, phoneVerified: true }); await next(); });
  app.route("/api/public", publicLeadRoutes);
  app.onError((error, c) => error instanceof ApiError ? c.json(errorBody(error.code, error.message, error.fields), error.status) : c.text("internal", 500));
  const call = (token = "capability-one", method = "GET") => app.request(`/api/public/unsubscribe/${encodeURIComponent(token)}`, { method }, { DB: d1 } as Env);
  const lead = () => db.prepare("SELECT unsubscribed_at,marketing_opt_in,alimtalk_opt_in FROM leads WHERE id='private-lead-one'").all()[0]!;
  return { db, call, lead, beforeUpdate: (hook: () => Promise<void>) => { beforeUpdate = hook; } };
}

describe("공개 수신 거부 브랜드 메타데이터", () => {
  it("토큰의 정확한 WS 이름만 반환하고 다른 WS의 로그인/동일 이메일·브랜드 테이블을 쓰지 않는다", async () => {
    const { call, lead } = await setup();
    const response = await call(); expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ workspaceName: "정확한 브랜드" });
    expect(await (await call("capability-two")).json()).toEqual({ workspaceName: "다른 브랜드" });
    expect(lead()).toEqual({ unsubscribed_at: null, marketing_opt_in: 1, alimtalk_opt_in: 1 }); expect(fetch).not.toHaveBeenCalled();
  });
  it("이미 거부한 상태도 같은 최소 DTO이며 이름 변경은 다음 조회에 반영된다", async () => {
    const { db, call } = await setup(); db.exec("UPDATE leads SET unsubscribed_at=1 WHERE id='private-lead-one'; UPDATE workspaces SET name='<img src=x onerror=alert(1)>' WHERE id='private-workspace-one'");
    expect(await (await call()).json()).toEqual({ workspaceName: "<img src=x onerror=alert(1)>" });
  });
  it("soft-delete 후 purge 전의 기존 유효성은 유지하고 삭제 상태를 공개하지 않는다", async () => {
    const { db, call } = await setup(); db.exec("UPDATE leads SET deleted_at=2 WHERE id='private-lead-one'");
    expect(await (await call()).json()).toEqual({ workspaceName: "정확한 브랜드" }); expect((await call("capability-one", "POST")).status).toBe(200);
  });
  it("unknown·purged lead·삭제 WS는 같은404를 반환하며 이름이나 내부정보가 없다", async () => {
    const { db, call } = await setup(); const unknown = await call("unknown"), expected = await unknown.json(); expect(unknown.status).toBe(404); expect(unknown.headers.get("Cache-Control")).toBe("no-store");
    db.exec("DELETE FROM leads WHERE id='private-lead-one'; DELETE FROM workspaces WHERE id='private-workspace-two'");
    for (const token of ["capability-one", "capability-two", "unknown"]) for (const method of ["GET", "POST"]) {
      const response = await call(token, method); expect(response.status).toBe(404); expect(await response.json()).toEqual(expected);
    }
  });
});

describe("기존 명시적 POST 수신 거부", () => {
  it("동의값·다른WS를 바꾸지 않고 반복 요청은 최초 거부 시각을 보존한다", async () => {
    const { db, call, lead } = await setup();
    const first = await call("capability-one", "POST"); expect(first.status).toBe(200); expect(await first.json()).toEqual({ ok: true });
    vi.mocked(Date.now).mockReturnValue(NOW + 1000); expect(await (await call("capability-one", "POST")).json()).toEqual({ ok: true });
    expect(lead()).toEqual({ unsubscribed_at: NOW, marketing_opt_in: 1, alimtalk_opt_in: 1 });
    expect(db.prepare("SELECT unsubscribed_at FROM leads WHERE id='private-lead-two'").all()[0]!.unsubscribed_at).toBeNull();
    db.exec("UPDATE leads SET unsubscribed_at=0 WHERE id='private-lead-one'"); await call("capability-one", "POST"); expect(lead().unsubscribed_at).toBe(0);
  });
  it("동시에 NULL을 읽어도 먼저 저장된 시각을 늦은 UPDATE가 덮지 않는다", async () => {
    const { call, lead, beforeUpdate } = await setup();
    beforeUpdate(async () => { vi.mocked(Date.now).mockReturnValue(NOW + 1000); expect((await call("capability-one", "POST")).status).toBe(200); });
    expect((await call("capability-one", "POST")).status).toBe(200); expect(lead().unsubscribed_at).toBe(NOW + 1000);
  });
});
