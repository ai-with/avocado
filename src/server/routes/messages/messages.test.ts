import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Auth } from "../../types";
import type { Db } from "../../db";
import { ApiError, errorBody } from "../../lib/errors";
import { messageTemplateRoutes, messageVariableRoutes } from ".";
import { messageRoutes } from "../guides/messages";

// 다른 워크스페이스 자원: 조회는 늘 비어 있고, 쓰기는 기록만 하는 DB
function emptyDb(writes: string[]): Db {
  const chain = { from: () => chain, innerJoin: () => chain, leftJoin: () => chain, where: () => chain, orderBy: () => chain, get: async () => undefined, then: (r: (v: unknown[]) => void) => r([]) };
  const write = (name: string) => () => ({ values: () => ({ onConflictDoUpdate: async () => void writes.push(name) }), set: () => ({ where: async () => void writes.push(name) }), where: async () => void writes.push(name) });
  return { select: () => chain, insert: write("insert"), update: write("update"), delete: write("delete") } as unknown as Db;
}

const auth: Auth = {
  sessionId: "s1",
  user: { id: "u1", email: "demo@example.com", name: "데모" },
  workspace: { id: "w1", name: "데모 브랜드", plan: "starter", onboardedAt: 1 },
  role: "owner",
  phone: null,
  phoneVerified: true,
};

function app(writes: string[]) {
  const a = new Hono<AppEnv>();
  a.use("*", async (c, next) => {
    c.set("db", emptyDb(writes));
    c.set("auth", auth);
    await next();
  });
  a.route("/api/message-variables", messageVariableRoutes);
  a.route("/api/message-templates", messageTemplateRoutes);
  a.route("/api/guides", messageRoutes);
  a.onError((err, c) => (err instanceof ApiError ? c.json(errorBody(err.code, err.message, err.fields), err.status) : c.json({ e: String(err) }, 500)));
  return a;
}

const call = (a: Hono<AppEnv>, method: string, path: string, body?: unknown) =>
  a.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } }, {});

describe("다른 워크스페이스 접근 거부", () => {
  it("남의 변수·템플릿은 수정·삭제·사용처 조회 모두 404 이고 아무것도 쓰지 않는다", async () => {
    const writes: string[] = [];
    const a = app(writes);
    expect((await call(a, "PATCH", "/api/message-variables/v9", { label: "x", defaultValue: "" })).status).toBe(404);
    expect((await call(a, "DELETE", "/api/message-variables/v9")).status).toBe(404);
    expect((await call(a, "GET", "/api/message-variables/v9/usage")).status).toBe(404);
    expect((await call(a, "PATCH", "/api/message-templates/t9", { name: "x", purpose: "contact", bodies: { ko: "hi" } })).status).toBe(404);
    expect((await call(a, "DELETE", "/api/message-templates/t9")).status).toBe(404);
    expect(writes).toEqual([]);
  });

  it("남의 캠페인 인플루언서에게는 값 조회·보냄 기록이 404", async () => {
    const writes: string[] = [];
    const a = app(writes);
    expect((await call(a, "GET", "/api/guides/g9/influencers/gi9/message-values")).status).toBe(404);
    expect((await call(a, "POST", "/api/guides/g9/influencers/gi9/messages", { channel: "dm", lang: "ko", body: "안녕", templateId: null })).status).toBe(404);
    expect(writes).toEqual([]);
  });

  it("기본 변수와 같은 key 는 만들 수 없다", async () => {
    const writes: string[] = [];
    const res = await call(app(writes), "POST", "/api/message-variables", { key: "brand_name", label: "브랜드", defaultValue: "" });
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
  });
});
