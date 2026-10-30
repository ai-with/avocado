import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Auth } from "../../types";
import type { Db } from "../../db";
import { ApiError, errorBody } from "../../lib/errors";
import { brandTermRoutes } from "./brand-terms";

// select().get() 는 gets 를 차례로 돌려주고, 쓰기는 기록만 하는 DB
function fakeDb(gets: unknown[], writes: string[]): Db {
  const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, orderBy: () => chain, get: async () => gets.shift(), then: (r: (v: unknown[]) => void) => r([]) };
  const write = (name: string) => () => ({ values: async () => void writes.push(name), set: () => ({ where: async () => void writes.push(name) }), where: async () => void writes.push(name) });
  return { select: () => chain, insert: write("insert"), update: write("update"), delete: write("delete") } as unknown as Db;
}

const auth = (role: Auth["role"]): Auth => ({
  sessionId: "s1",
  user: { id: "u1", email: "demo@example.com", name: "데모" },
  workspace: { id: "w1", name: "데모 브랜드", plan: "starter", onboardedAt: 1 },
  role,
  phone: null,
  phoneVerified: true,
});

function app(gets: unknown[], writes: string[], role: Auth["role"] = "owner") {
  const a = new Hono<AppEnv>();
  a.use("*", async (c, next) => {
    c.set("db", fakeDb(gets, writes));
    c.set("auth", auth(role));
    await next();
  });
  a.route("/api/brands", brandTermRoutes);
  a.onError((err, c) => (err instanceof ApiError ? c.json(errorBody(err.code, err.message, err.fields), err.status) : c.json({ e: String(err) }, 500)));
  return a;
}

const call = (a: Hono<AppEnv>, method: string, path: string, body?: unknown) =>
  a.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } }, {});

const BRAND = { id: "b1", workspaceId: "w1", name: "데모", legalPresetEnabled: true, legalPresetDisabled: [] };

describe("브랜드 검수 사전 권한", () => {
  it("다른 워크스페이스 브랜드는 조회·추가·수정·삭제·법규 설정 모두 404 이고 아무것도 쓰지 않는다", async () => {
    const writes: string[] = [];
    const a = app([], writes);
    expect((await call(a, "GET", "/api/brands/b9/terms")).status).toBe(404);
    expect((await call(a, "POST", "/api/brands/b9/terms", { kind: "forbidden", term: "x" })).status).toBe(404);
    expect((await call(a, "PATCH", "/api/brands/b9/terms/t1", { enabled: false })).status).toBe(404);
    expect((await call(a, "DELETE", "/api/brands/b9/terms/t1")).status).toBe(404);
    expect((await call(a, "PATCH", "/api/brands/b9/legal-preset", { enabled: false })).status).toBe(404);
    expect(writes).toEqual([]);
  });

  it("편집자가 아니면 쓰기를 막는다", async () => {
    const writes: string[] = [];
    const res = await call(app([BRAND], writes, "viewer"), "POST", "/api/brands/b1/terms", { kind: "forbidden", term: "x" });
    expect(res.status).toBe(403);
    expect(writes).toEqual([]);
  });

  it("같은 브랜드에 같은 종류·항목이 있으면 409 로 거부한다", async () => {
    const writes: string[] = [];
    const res = await call(app([BRAND, { id: "t0" }], writes), "POST", "/api/brands/b1/terms", { kind: "forbidden", term: "업계 1위" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { fields: Record<string, string> } }).error.fields.term).toBeTruthy();
    expect(writes).toEqual([]);
  });

  it("다른 브랜드 사전 항목은 수정할 수 없다", async () => {
    const writes: string[] = [];
    expect((await call(app([BRAND, undefined], writes), "PATCH", "/api/brands/b1/terms/t9", { enabled: false })).status).toBe(404);
    expect(writes).toEqual([]);
  });

  it("중복이 없으면 추가한다", async () => {
    const writes: string[] = [];
    expect((await call(app([BRAND, undefined], writes), "POST", "/api/brands/b1/terms", { kind: "hashtag", term: "#광고" })).status).toBe(201);
    expect(writes).toEqual(["insert"]);
  });
});
