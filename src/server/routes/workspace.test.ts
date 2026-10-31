import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { getDb } from "../db";
import { ApiError, errorBody } from "../lib/errors";
import { sha256Hex } from "../lib/ids";
import { loadSession } from "../middleware/auth";
import { workspaceRoutes } from "./workspace";
import { workspacesRoutes } from "./workspaces";
import { inviteRoutes } from "./invites";
import { accountRoutes } from "./auth/account";
import { createSqliteD1, type TestSqlite } from "../test/sqlite-d1";
import type { Role } from "../../shared/roles";

const NOW = Date.parse("2026-11-01T07:00:00Z"), databases: TestSqlite[] = [];
const people = ["owner", "editor", "editor2", "approver", "viewer", "join"] as const;
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.spyOn(console, "error").mockImplementation(() => {}); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external requests"); })); });
afterEach(() => { databases.splice(0).forEach((db) => db.close()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup() {
  const { db, d1: native } = await createSqliteD1(); databases.push(db);
  let beforeBatch: ((sql: string[]) => void | Promise<void>) | undefined, loseResponse = false;
  let beforeStatement: ((sql: string) => void | Promise<void>) | undefined;
  const statements = new WeakMap<object, string>();
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const proxy = new Proxy(statement, { get(target, key) {
      if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values), sql);
      if (["run", "all", "raw"].includes(String(key))) return async (...values: unknown[]) => {
        if (/^update "sessions"/i.test(sql) && beforeStatement) { const hook = beforeStatement; beforeStatement = undefined; await hook(sql); }
        return Reflect.get(target, key).apply(target, values);
      };
      return Reflect.get(target, key);
    } });
    statements.set(proxy, sql); return proxy;
  };
  const d1 = { ...native, prepare: (sql: string) => wrap(native.prepare(sql), sql), batch: async (items: D1PreparedStatement[]) => {
    const hook = beforeBatch; beforeBatch = undefined; await hook?.(items.map((item) => statements.get(item) ?? ""));
    const result = await native.batch(items); if (loseResponse) { loseResponse = false; throw new Error("private write response lost"); } return result;
  } } as D1Database;
  db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w1','One',1),('w2','Two',2)");
  for (let index = 0; index < people.length; index++) {
    const id = people[index]!, role = id === "editor2" ? "editor" : id === "join" ? "viewer" : id;
    db.prepare("INSERT INTO users(id,email,password_hash,name,phone_verified_at,created_at) VALUES(?,?,'',?,?,?)").run(id, `${id}@example.com`, id, NOW, 1);
    db.prepare("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES(?,?,?,?)").run(id === "join" ? "w2" : "w1", id, role, index + 1);
    db.prepare("INSERT INTO sessions(id,user_id,current_workspace_id,expires_at,created_at) VALUES(?,?,?,?,?)").run(await sha256Hex(`token-${id}`), id, id === "join" ? "w2" : "w1", NOW + 3_600_000, 1);
  }
  db.exec("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES('w2','owner','owner',1)");
  db.prepare("INSERT INTO sessions(id,user_id,current_workspace_id,expires_at,created_at) VALUES(?,'owner','w1',?,1)").run(await sha256Hex("other-session"), NOW + 3_600_000);
  const env = { DB: d1, APP_ENV: "production", APP_URL: "https://app.test", RESEND_API_KEY: "synthetic-key" } as Env;
  const app = new Hono<AppEnv>(); app.use("*", async (c, next) => { c.set("db", getDb(c.env.DB)); await next(); }); app.use("*", loadSession);
  app.route("/api/workspace", workspaceRoutes); app.route("/api/workspaces", workspacesRoutes); app.route("/api/invites", inviteRoutes); app.route("/api/auth", accountRoutes);
  app.onError((error, c) => error instanceof ApiError ? c.json(errorBody(error.code, error.message, error.fields), error.status) : c.text("internal", 500));
  const call = (user: string, method: string, path: string, body?: unknown, cookie = `token-${user}`) => app.request(`https://app.test/api${path}`, { method, headers: { Cookie: `sid=${cookie}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(path === "/workspaces" ? { expectedUserId: user, ...(body as object) } : body) }, env);
  const issue = async (user = "editor", email = "join@example.com", role = "viewer") => {
    const response = await call(user, "POST", "/workspace/invites", { email, role, expectedWorkspaceId: "w1" }); expect(response.status).toBe(201);
    return (await response.json() as { invite: { id: string; url: string }; email: { delivered: boolean; reason: string } });
  };
  const count = (table: string, where = "1") => Number(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).all()[0]!.n);
  return { db, env, call, issue, count, beforeStatement: (hook: (sql: string) => void | Promise<void>) => { beforeStatement = hook; }, before: (hook: (sql: string[]) => void | Promise<void>) => { beforeBatch = hook; }, loseResponse: () => { loseResponse = true; } };
}
const bodyOf = async (response: Response) => await response.json() as Record<string, unknown>;

describe("추가 워크스페이스 원자 생성", () => {
  it("새 WS·owner·기본 브랜드·현재 session만 함께 만들고 요청 replay는 재전환하지 않는다", async () => {
    const { db, call, count } = await setup(), body = { requestId: crypto.randomUUID(), workspaceName: "New", expectedWorkspaceId: "w1" };
    const first = await call("owner", "POST", "/workspaces", body); expect(first.status).toBe(201); const result = await bodyOf(first), id = String(result.workspaceId);
    expect(result.selected).toBe(true); expect(count("workspaces")).toBe(3); expect(count("members", `workspace_id='${id}' AND user_id='owner' AND role='owner'`)).toBe(1); expect(count("brands", `workspace_id='${id}'`)).toBe(1);
    expect(db.prepare("SELECT current_workspace_id FROM sessions WHERE id=?").all(await sha256Hex("other-session"))[0]!.current_workspace_id).toBe("w1");
    expect((await call("owner", "POST", "/workspaces/switch", { workspaceId: "w2" })).status).toBe(200);
    const replay = await call("owner", "POST", "/workspaces", body); expect(replay.status).toBe(200); expect(await bodyOf(replay)).toMatchObject({ workspaceId: id, replayed: true, selected: false });
    expect(count("workspaces")).toBe(3); expect(count("brands")).toBe(1); expect((await bodyOf(await call("owner", "GET", "/auth/me"))).workspace).toMatchObject({ id: "w2" });
    expect((await call("owner", "POST", "/workspaces", { ...body, workspaceName: "Different" })).status).toBe(409);
  });
  it("같은 requestId의 동시 요청은 하나만 만든다", async () => {
    const { call, count } = await setup(), body = { requestId: crypto.randomUUID(), workspaceName: "Concurrent", expectedWorkspaceId: "w1" };
    const responses = await Promise.all([call("owner", "POST", "/workspaces", body), call("owner", "POST", "/workspaces", body)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]); expect(count("workspaces")).toBe(3); expect(count("brands")).toBe(1); expect(count("workspace_creation_requests")).toBe(1);
  });
  it("brand 실패는 전부 rollback하고 모호한 commit 응답은 같은 요청 원장으로 복구한다", async () => {
    const { db, call, count, loseResponse } = await setup(), body = { requestId: crypto.randomUUID(), workspaceName: "Rollback", expectedWorkspaceId: "w1" };
    db.exec("CREATE TRIGGER fail_brand BEFORE INSERT ON brands BEGIN SELECT RAISE(ABORT,'private-failure'); END");
    expect((await call("owner", "POST", "/workspaces", body)).status).toBe(503); expect(count("workspaces")).toBe(2); expect(count("workspace_creation_requests")).toBe(0);
    db.exec("DROP TRIGGER fail_brand"); loseResponse();
    const response = await call("owner", "POST", "/workspaces", body); expect(response.status).toBe(200); expect((await bodyOf(response)).replayed).toBe(true); expect(count("workspaces")).toBe(3); expect(count("brands")).toBe(1);
  });
  it("session 전환·미인증·다른 session replay는 새 생성/다른 session 전환을 하지 않는다", async () => {
    const { db, call, count, before } = await setup(), body = { requestId: crypto.randomUUID(), workspaceName: "Context", expectedWorkspaceId: "w1" };
    before(async () => { expect((await call("owner", "POST", "/workspaces/switch", { workspaceId: "w2" })).status).toBe(200); });
    expect((await call("owner", "POST", "/workspaces", body)).status).toBe(409); expect(count("workspaces")).toBe(2);
    db.exec("UPDATE sessions SET current_workspace_id='w1' WHERE user_id='owner'");
    expect((await call("owner", "POST", "/workspaces", body)).status).toBe(409);
    const freshBody = { ...body, requestId: crypto.randomUUID() };
    const result = await bodyOf(await call("owner", "POST", "/workspaces", freshBody));
    expect(await bodyOf(await call("owner", "POST", "/workspaces", freshBody, "other-session"))).toMatchObject({ workspaceId: result.workspaceId, selected: false });
    db.exec("UPDATE users SET phone_verified_at=NULL WHERE id='viewer'"); expect((await call("viewer", "POST", "/workspaces", { ...body, requestId: crypto.randomUUID() })).status).toBe(403);
  });
});

describe("역할별 초대 권한과 issuer", () => {
  it.each(["owner", "editor", "approver", "viewer"] as Role[])("%s 발급은 허용 역할/세 대상에만 적용된다", async (user) => {
    const { call, count } = await setup();
    for (const role of ["editor", "approver", "viewer"]) {
      const response = await call(user, "POST", "/workspace/invites", { email: `new-${user}-${role}@example.com`, role, expectedWorkspaceId: "w1" });
      expect(response.status).toBe(user === "owner" || user === "editor" ? 201 : 403);
    }
    expect(count("invites", "issuer_required=0")).toBe(0); expect(fetch).not.toHaveBeenCalled();
    expect((await call(user, "POST", "/workspace/invites", { email: "new@example.com", role: "owner", expectedWorkspaceId: "w1" })).status).toBe(user === "owner" || user === "editor" ? 400 : 403);
  });
  it("editor는 자기 pending만 조회·취소, owner는 전체, 다른 역할은 capability를 받지 않는다", async () => {
    const { call, issue } = await setup(), owner = await issue("owner", "one@example.com"), editor = await issue("editor", "two@example.com"); await issue("editor2", "three@example.com");
    expect((await bodyOf(await call("owner", "GET", "/workspace/members"))).invites).toHaveLength(3);
    expect((await bodyOf(await call("editor", "GET", "/workspace/members"))).invites).toMatchObject([{ id: editor.invite.id }]);
    for (const user of ["viewer", "approver"]) expect((await bodyOf(await call(user, "GET", "/workspace/members"))).invites).toEqual([]);
    expect((await call("editor", "DELETE", `/workspace/invites/${owner.invite.id}?expectedWorkspaceId=w1`)).status).toBe(404);
    expect((await call("editor", "DELETE", `/workspace/invites/${editor.invite.id}?expectedWorkspaceId=w1`)).status).toBe(200);
    expect((await call("owner", "DELETE", `/workspace/invites/${owner.invite.id}?expectedWorkspaceId=w1`)).status).toBe(200);
  });
  it("강등/제거와 pending 폐기는 원자적이고 재가입·재승격으로 옛 token이 살아나지 않는다", async () => {
    const { db, call, issue } = await setup(), first = await issue();
    expect((await call("owner", "PATCH", "/workspace/members/editor", { role: "viewer", expectedWorkspaceId: "w1" })).status).toBe(200);
    expect((await call("join", "GET", `/invites/${first.invite.url.split('/').at(-1)}`)).status).toBe(404);
    expect((await call("owner", "PATCH", "/workspace/members/editor", { role: "editor", expectedWorkspaceId: "w1" })).status).toBe(200);
    const second = await issue();
    expect((await call("owner", "DELETE", "/workspace/members/editor?expectedWorkspaceId=w1")).status).toBe(200);
    db.exec("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES('w1','editor','editor',2)");
    expect((await call("join", "GET", `/invites/${second.invite.url.split('/').at(-1)}`)).status).toBe(404);
  });
  it("issuer user 삭제의 SET NULL은 strict token을 legacy로 바꾸지 않는다", async () => {
    const { db, call, issue } = await setup(), invite = await issue(), token = invite.invite.url.split('/').at(-1)!;
    db.exec("DELETE FROM users WHERE id='editor'"); expect(db.prepare("SELECT invited_by,issuer_required FROM invites").all()[0]).toMatchObject({ invited_by: null, issuer_required: 1 });
    expect((await call("join", "GET", `/invites/${token}`)).status).toBe(410); expect((await call("join", "POST", `/invites/${token}/accept`)).status).toBe(410);
  });
  it("raw strict NULL과 명시 legacy NULL을 구분하고 owner 관리권한을 확대하지 않는다", async () => {
    const { db, call, count } = await setup();
    db.prepare("INSERT INTO invites(id,workspace_id,email,role,token,issuer_required,expires_at,created_at) VALUES('legacy','w1','join@example.com','viewer','legacy',0,?,1)").run(NOW + 60_000);
    db.prepare("INSERT INTO invites(id,workspace_id,email,role,token,expires_at,created_at) VALUES('strict','w1','join@example.com','viewer','strict',?,1)").run(NOW + 60_000);
    expect((await call("join", "GET", "/invites/strict")).status).toBe(410);
    const publicLegacy = await call("join", "GET", "/invites/legacy"); expect(publicLegacy.status).toBe(200); expect(publicLegacy.headers.get("Cache-Control")).toBe("no-store");
    expect((await call("join", "POST", "/invites/legacy/accept")).status).toBe(200); expect(count("members", "workspace_id='w1' AND user_id='join'")).toBe(1);
    expect((await call("editor", "PATCH", "/workspace/members/viewer", { role: "editor", expectedWorkspaceId: "w1" })).status).toBe(403);
    expect((await call("owner", "DELETE", "/workspace/members/owner?expectedWorkspaceId=w1")).status).toBe(400);
  });
  it("취소 vs 수락·stale editor vs 발급 경합은 실제 쓰기 직전 predicate에서 차단한다", async () => {
    const { db, call, issue, count, before } = await setup(), invite = await issue(), token = invite.invite.url.split('/').at(-1)!;
    before(async () => { expect((await call("owner", "DELETE", `/workspace/invites/${invite.invite.id}?expectedWorkspaceId=w1`)).status).toBe(200); });
    expect((await call("join", "POST", `/invites/${token}/accept`)).status).toBe(404); expect(count("members", "workspace_id='w1' AND user_id='join'")).toBe(0);
    before(() => { db.exec("UPDATE members SET role='viewer' WHERE user_id='editor' AND workspace_id='w1'"); });
    expect((await call("editor", "POST", "/workspace/invites", { email: "stale@example.com", role: "viewer", expectedWorkspaceId: "w1" })).status).toBe(403);
    expect(count("invites")).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it("동시 수락은 한 번만 consume하고 기존 membership의 역할을 덮지 않는다", async () => {
    const { db, call, issue, count } = await setup(), invite = await issue(), token = invite.invite.url.split('/').at(-1)!;
    db.exec("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES('w1','join','approver',1)");
    const replies = await Promise.all([call("join", "POST", `/invites/${token}/accept`), call("join", "POST", `/invites/${token}/accept`)]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 410]); expect(count("members", "workspace_id='w1' AND user_id='join' AND role='approver'")).toBe(1); expect(count("events", "name='invite_accepted'")).toBe(1);
  });
  it("pending 폐기 SQL이 실패하면 역할 강등도 rollback된다", async () => {
    const { db, call, issue } = await setup(); await issue();
    db.exec("CREATE TRIGGER block_revoke BEFORE DELETE ON invites BEGIN SELECT RAISE(ABORT,'private-token'); END");
    expect((await call("owner", "PATCH", "/workspace/members/editor", { role: "viewer", expectedWorkspaceId: "w1" })).status).toBe(503);
    expect(db.prepare("SELECT role FROM members WHERE workspace_id='w1' AND user_id='editor'").all()[0]!.role).toBe("editor");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-token");
  });
});

describe("소유자 설문과 멤버별 skip", () => {
  it.each(["editor", "approver", "viewer"])("%s 설문은 skipped:true도403이며 개인 skip만 남는다", async (user) => {
    const { call, db, count } = await setup();
    expect((await call(user, "POST", "/workspace/onboarding", { expectedWorkspaceId: "w1", skipped: true })).status).toBe(403);
    expect((await call(user, "POST", "/workspace/onboarding/skip", { expectedWorkspaceId: "w1" })).status).toBe(200);
    const current = await bodyOf(await call(user, "GET", "/auth/me")); expect(current.workspace).toMatchObject({ onboardedAt: null, onboardingSkippedAt: NOW });
    expect(db.prepare("SELECT onboarding,onboarded_at FROM workspaces WHERE id='w1'").all()[0]).toEqual({ onboarding: null, onboarded_at: null }); expect(count("events", "name='onboarding_completed'")).toBe(0);
    expect((await call(user, "POST", "/workspace/onboarding/skip", { expectedWorkspaceId: "w1", source: "not-allowed" })).status).toBe(400);
  });
  it("owner CAS는 한 답변·한 완료 event만 남기며 non-owner skip와 별개다", async () => {
    const { call, db, count } = await setup(); await call("editor", "POST", "/workspace/onboarding/skip", { expectedWorkspaceId: "w1" });
    const replies = await Promise.all([call("owner", "POST", "/workspace/onboarding", { expectedWorkspaceId: "w1", source: "first" }), call("owner", "POST", "/workspace/onboarding", { expectedWorkspaceId: "w1", source: "second" })]);
    expect(replies.map((response) => response.status).sort()).toEqual([200, 409]); expect(count("events", "name='onboarding_completed'")).toBe(1);
    expect(JSON.parse(String(db.prepare("SELECT onboarding FROM workspaces WHERE id='w1'").all()[0]!.onboarding)).source).toMatch(/^(first|second)$/);
  });
  it("다른 탭이 전환한 뒤 owner 설문/초대는 어느 WS에도 저장하지 않는다", async () => {
    const { call, db, before, count } = await setup();
    before(async () => { await call("owner", "POST", "/workspaces/switch", { workspaceId: "w2" }); });
    expect((await call("owner", "POST", "/workspace/onboarding", { expectedWorkspaceId: "w1", source: "stale" })).status).toBe(409);
    expect(db.prepare("SELECT onboarded_at FROM workspaces WHERE id IN ('w1','w2')").all().every((row) => row.onboarded_at === null)).toBe(true);
    expect((await call("owner", "POST", "/workspace/invites", { email: "stale@example.com", role: "viewer", expectedWorkspaceId: "w1" })).status).toBe(409); expect(count("invites")).toBe(0);
  });
});

describe("추가 경계 회귀", () => {
  it("0031은 migration 전 NULL만 legacy로 분류하고 이후 default는 strict다", async () => {
    const { db } = await createSqliteD1({ migrateThrough: 29 }); databases.push(db);
    db.exec("INSERT INTO users(id,email,password_hash,name,created_at) VALUES('issuer','issuer@example.com','','Issuer',1)");
    db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('old','Old',1)");
    db.exec("INSERT INTO invites(id,workspace_id,email,role,token,invited_by,expires_at,created_at) VALUES('old-null','old','x@example.com','viewer','old-null',NULL,2,1),('old-issuer','old','y@example.com','viewer','old-issuer','issuer',2,1)");
    const fs = await import("node:fs"); db.exec(fs.readFileSync("migrations/0031_workspace_access.sql", "utf8"));
    db.exec("INSERT INTO invites(id,workspace_id,email,role,token,expires_at,created_at) VALUES('new-null','old','z@example.com','viewer','new-null',2,1)");
    expect(db.prepare("SELECT id,issuer_required FROM invites ORDER BY id").all()).toEqual([{ id: "new-null", issuer_required: 1 }, { id: "old-issuer", issuer_required: 1 }, { id: "old-null", issuer_required: 0 }]);
  });
  it("현재 viewer도 자신의 새 owner WS를 만들며 기존 WS 권한은 바뀌지 않는다", async () => {
    const { db, call } = await setup(); const response = await call("viewer", "POST", "/workspaces", { requestId: crypto.randomUUID(), workspaceName: "Own", expectedWorkspaceId: "w1" });
    expect(response.status).toBe(201); const result = await bodyOf(response);
    expect(db.prepare("SELECT role FROM members WHERE workspace_id=? AND user_id='viewer'").all(String(result.workspaceId))[0]!.role).toBe("owner");
    expect(db.prepare("SELECT role FROM members WHERE workspace_id='w1' AND user_id='viewer'").all()[0]!.role).toBe("viewer");
  });
  it("발급자 권한이 수락 직전에 사라지면 pending row가 남아 있어도 가입시키지 않는다", async () => {
    const { db, call, issue, before, count } = await setup(), invite = await issue(), token = invite.invite.url.split('/').at(-1)!;
    before(() => { db.exec("UPDATE members SET role='viewer' WHERE workspace_id='w1' AND user_id='editor'"); });
    expect((await call("join", "POST", `/invites/${token}/accept`)).status).toBe(410); expect(count("members", "workspace_id='w1' AND user_id='join'")).toBe(0);
  });
  it("생성된 WS를 지워도 같은 요청이 새 WS를 되살리지 않는다", async () => {
    const { db, call, count } = await setup(), body = { requestId: crypto.randomUUID(), workspaceName: "Deleted", expectedWorkspaceId: "w1" };
    const result = await bodyOf(await call("owner", "POST", "/workspaces", body)); db.prepare("DELETE FROM workspaces WHERE id=?").run(String(result.workspaceId));
    expect((await call("owner", "POST", "/workspaces", body)).status).toBe(409); expect(count("workspaces")).toBe(2); expect(count("workspace_creation_requests")).toBe(1);
  });
});

describe("계정·첫 WS 경계", () => {
  it("다른 계정의 오래된 생성 화면은 새 계정 소유 WS를 만들지 않는다", async () => {
    const { call, count } = await setup();
    expect((await call("viewer", "POST", "/workspaces", { expectedUserId: "owner", requestId: crypto.randomUUID(), workspaceName: "Stale user", expectedWorkspaceId: "w1" })).status).toBe(409);
    expect(count("workspaces")).toBe(2);
  });
  it("기존 첫 WS 경로도 동시 요청에서 하나의 owner·brand만 만든다", async () => {
    const { db, call, count } = await setup(); db.exec("DELETE FROM members WHERE user_id='join'; UPDATE sessions SET current_workspace_id=NULL WHERE user_id='join'");
    const replies = await Promise.all([call("join", "POST", "/auth/onboarding", { workspaceName: "First", expectedUserId: "join" }), call("join", "POST", "/auth/onboarding", { workspaceName: "First", expectedUserId: "join" })]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([201, 409]); expect(count("workspaces")).toBe(3); expect(count("brands")).toBe(1); expect(count("members", "user_id='join' AND role='owner'")).toBe(1);
  });
});

describe("불명확한 생성 요청의 terminal fence", () => {
  it("context 취소 receipt를 먼저 저장하면 옛 in-flight batch도 나중에 생성하지 못한다", async () => {
    const { db, call, count, before } = await setup(), body = { requestId: crypto.randomUUID(), workspaceName: "Late", expectedWorkspaceId: "w1" };
    before(async () => {
      await call("owner", "POST", "/workspaces/switch", { workspaceId: "w2" });
      const cancelled = await call("owner", "POST", "/workspaces", body); expect(cancelled.status).toBe(409); expect((await bodyOf(cancelled)).error).toMatchObject({ code: "request_cancelled" });
      await call("owner", "POST", "/workspaces/switch", { workspaceId: "w1" });
    });
    expect((await call("owner", "POST", "/workspaces", body)).status).toBe(409);
    expect(count("workspaces")).toBe(2); expect(count("brands")).toBe(0); expect(db.prepare("SELECT state FROM workspace_creation_requests").all()).toEqual([{ state: "cancelled" }]);
  });
});


describe("session fallback CAS", () => {
  it.each([null, "stale-workspace"])("%s 를 읽은 fallback은 나중 W2 선택을 덮지 않고 Auth도 W2로 읽는다", async (original) => {
    const { db, call, beforeStatement } = await setup(); const id = await sha256Hex("token-owner");
    db.prepare("UPDATE sessions SET current_workspace_id=? WHERE id=?").run(original, id);
    beforeStatement(async () => { expect((await call("owner", "POST", "/workspaces/switch", { workspaceId: "w2" })).status).toBe(200); });
    const response = await call("owner", "GET", "/auth/me"); expect(response.status).toBe(200);
    expect((await bodyOf(response)).workspace).toMatchObject({ id: "w2" });
    expect(db.prepare("SELECT current_workspace_id FROM sessions WHERE id=?").all(id)[0]!.current_workspace_id).toBe("w2");
  });
});


describe("fallback 재조회 범위", () => {
  it("옛 목록에 없던 새 WS가 선택돼도 memberships를 다시 읽는다", async () => {
    const { db, call, beforeStatement } = await setup(), id = await sha256Hex("token-owner"); let created: string | undefined;
    db.prepare("UPDATE sessions SET current_workspace_id=NULL WHERE id=?").run(id);
    beforeStatement(async () => {
      const response = await call("owner", "POST", "/workspaces", { requestId: crypto.randomUUID(), workspaceName: "During fallback", expectedWorkspaceId: "w1" }); expect(response.status).toBe(201); created = String((await bodyOf(response)).workspaceId);
    });
    const result = await bodyOf(await call("owner", "GET", "/auth/me")); expect(result.workspace).toMatchObject({ id: created }); expect(result.role).toBe("owner");
    expect(db.prepare("SELECT current_workspace_id FROM sessions WHERE id=?").all(id)[0]!.current_workspace_id).toBe(created);
  });
  it("fallback 후보 membership이 제거되면 남은 WS와 현재 역할을 다시 읽는다", async () => {
    const { db, call, beforeStatement } = await setup(), id = await sha256Hex("token-editor");
    db.prepare("UPDATE sessions SET current_workspace_id=NULL WHERE id=?").run(id); db.exec("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES('w2','editor','viewer',99)");
    beforeStatement(async () => { expect((await call("owner", "DELETE", "/workspace/members/editor?expectedWorkspaceId=w1")).status).toBe(200); });
    const result = await bodyOf(await call("editor", "GET", "/auth/me")); expect(result.workspace).toMatchObject({ id: "w2" }); expect(result.role).toBe("viewer");
  });
  it("읽은 뒤 만료된 session에는 fallback을 저장하지 않는다", async () => {
    const { db, call, beforeStatement } = await setup(), id = await sha256Hex("token-owner"); db.prepare("UPDATE sessions SET current_workspace_id=NULL WHERE id=?").run(id);
    beforeStatement(() => { db.prepare("UPDATE sessions SET expires_at=? WHERE id=?").run(NOW, id); });
    expect(await (await call("owner", "GET", "/auth/me")).json()).toBeNull(); expect(db.prepare("SELECT current_workspace_id FROM sessions WHERE id=?").all(id)[0]!.current_workspace_id).toBeNull();
  });
});


describe("마지막 membership 제거 후 정상 복구", () => {
  it("없는 current pointer도 CAS로 NULL 정리한 뒤 자신의 첫 owner WS를 만들 수 있다", async () => {
    const { db, call, count } = await setup();
    expect((await call("owner", "DELETE", "/workspace/members/editor?expectedWorkspaceId=w1")).status).toBe(200);
    const current = await bodyOf(await call("editor", "GET", "/auth/me")); expect(current.workspace).toBeNull(); expect(current.role).toBeNull();
    expect(db.prepare("SELECT current_workspace_id FROM sessions WHERE user_id='editor'").all()[0]!.current_workspace_id).toBeNull();
    const response = await call("editor", "POST", "/auth/onboarding", { workspaceName: "Recovered own", expectedUserId: "editor" }); expect(response.status).toBe(201);
    expect(count("members", "user_id='editor' AND role='owner'")).toBe(1);
  });
});
