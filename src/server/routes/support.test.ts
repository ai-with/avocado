import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { getTableName, type Table } from "drizzle-orm";
import type { AppEnv, Auth } from "../types";
import type { Db } from "../db";
import { ApiError, errorBody } from "../lib/errors";
import { supportRoutes } from "./support";

type Inserted = { table: string; row: Record<string, unknown> };

// 라우트가 쓰는 만큼만 흉내 낸 DB: 최근 건수 조회는 0건, insert 는 기록만 한다
function fakeDb(inserted: Inserted[]): Db {
  const chain = { from: () => chain, where: () => chain, get: async () => ({ n: 0 }) };
  const db = {
    select: () => chain,
    insert: (table: Table) => ({ values: async (row: Record<string, unknown>) => void inserted.push({ table: getTableName(table), row }) }),
  };
  return db as unknown as Db;
}

const auth: Auth = {
  sessionId: "s1",
  user: { id: "u1", email: "demo@example.com", name: "데모" },
  workspace: { id: "w1", name: "데모 브랜드", plan: "starter", onboardedAt: 1 },
  role: "owner",
  phone: null,
  phoneVerified: true,
};

function makeApp(inserted: Inserted[]) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", fakeDb(inserted));
    c.set("auth", auth);
    await next();
  });
  app.route("/api/support", supportRoutes);
  app.onError((err, c) => (err instanceof ApiError ? c.json(errorBody(err.code, err.message, err.fields), err.status) : c.json({}, 500)));
  return app;
}

const post = (app: Hono<AppEnv>, body: unknown) =>
  app.request("/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, {});

describe("POST /api/support", () => {
  it("잘못된 유형·짧은 내용·이메일 형식이면 400 이고 저장하지 않는다", async () => {
    const inserted: Inserted[] = [];
    const res = await post(makeApp(inserted), { type: "refund", body: "짧아요", replyEmail: "not-an-email" });
    expect(res.status).toBe(400);
    const data: { error: { fields: Record<string, string> } } = await res.json();
    expect(Object.keys(data.error.fields).sort()).toEqual(["body", "replyEmail", "type"]);
    expect(inserted).toHaveLength(0);
  });

  it("정상 입력은 접수 상태로 저장하고 support_requested 이벤트를 남긴다", async () => {
    const inserted: Inserted[] = [];
    const res = await post(makeApp(inserted), { type: "plan", body: "요금제를 Growth 로 바꾸고 싶어요.", replyEmail: " Demo@Example.com " });
    expect(res.status).toBe(201);
    const saved = inserted.find((x) => x.table === "support_requests")?.row;
    expect(saved).toMatchObject({ workspaceId: "w1", userId: "u1", type: "plan", status: "received", replyEmail: "demo@example.com" });
    expect(inserted.find((x) => x.table === "events")?.row).toMatchObject({ name: "support_requested", workspaceId: "w1" });
  });
});
