import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Auth } from "../../types";
import type { Db } from "../../db";
import { ApiError, errorBody } from "../../lib/errors";
import { participationFromEvent } from "../../lib/participation";
import { participationRoutes } from "./participation";

type Writes = string[];

// 조회는 항상 found 를 돌려주는 DB. 쓰기는 기록만 한다
function fakeDb(found: unknown, writes: Writes): Db {
  const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, orderBy: () => chain, get: async () => found };
  const db = {
    select: () => chain,
    insert: () => ({ values: async () => void writes.push("insert") }),
    update: () => ({ set: () => ({ where: async () => void writes.push("update") }) }),
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

function request(found: unknown, writes: Writes, path: string, body: unknown) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", fakeDb(found, writes));
    c.set("auth", auth);
    await next();
  });
  app.route("/api/guides", participationRoutes);
  app.onError((err, c) => (err instanceof ApiError ? c.json(errorBody(err.code, err.message, err.fields), err.status) : c.json({}, 500)));
  return app.request(`/api/guides/g1/influencers/gi1/${path}`, { method: path === "logs" ? "POST" : "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, {});
}

describe("다른 워크스페이스 접근 거부", () => {
  it("가이드가 내 워크스페이스에 없으면 상태·조건·메모 모두 404 이고 아무것도 쓰지 않는다", async () => {
    const writes: Writes = [];
    expect((await request(undefined, writes, "status", { status: "done" })).status).toBe(404);
    expect((await request(undefined, writes, "terms", { amount: 1, currency: "KRW", deliverables: "", memo: "" })).status).toBe(404);
    expect((await request(undefined, writes, "logs", { body: "메모" })).status).toBe(404);
    expect(writes).toHaveLength(0);
  });

  it("다른 워크스페이스 참여 줄에 온 사건은 상태·이력을 남기지 않는다", async () => {
    const writes: Writes = [];
    await participationFromEvent(fakeDb(undefined, writes), "w1", "upload_completed", { gi_id: "gi-other" });
    expect(writes).toHaveLength(0);
  });

  it("내 줄에 온 업로드 사건은 이력 + 앞으로 전이(검수) + 상태 이력을 남긴다", async () => {
    const writes: Writes = [];
    await participationFromEvent(fakeDb({ status: "progress" }, writes), "w1", "upload_completed", { gi_id: "gi1" });
    expect(writes).toEqual(["insert", "update", "insert"]);
  });

  it("완료 뒤 업로드는 이력만 남기고 상태는 그대로", async () => {
    const writes: Writes = [];
    await participationFromEvent(fakeDb({ status: "done" }, writes), "w1", "upload_completed", { gi_id: "gi1" });
    expect(writes).toEqual(["insert"]);
  });
});
