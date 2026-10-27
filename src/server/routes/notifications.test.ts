import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { getTableName, type Table } from "drizzle-orm";
import type { AppEnv, Auth } from "../types";
import type { Db } from "../db";
import { ApiError, errorBody } from "../lib/errors";
import { draftNotification } from "../lib/notifications";
import { countUnread, relativeTime } from "../../shared/notifications";
import { notificationRoutes } from "./notifications";

const who = { name: "하루", guide: "가을 캠페인" };

describe("이벤트 → 알림 매핑", () => {
  it("수락·철회는 가이드 상세로, 업로드·피드백 반영은 검수 상세로 보낸다", () => {
    expect(draftNotification("participation_accepted", { guide_id: "g1", gi_id: "gi1" }, who)).toEqual({ kind: "participation_accepted", title: '하루님이 "가을 캠페인" 참여를 수락했어요', linkPath: "/dashboard/guides/g1" });
    expect(draftNotification("consent_withdrawn", { guide_id: "g1" }, who)?.linkPath).toBe("/dashboard/guides/g1");
    expect(draftNotification("upload_completed", { submission_id: "s1" }, who)).toMatchObject({ kind: "upload_completed", linkPath: "/dashboard/reviews/s1", title: '하루님이 "가을 캠페인" 영상을 올렸어요' });
    expect(draftNotification("upload_completed", { submission_id: "s1", external: true }, who)?.title).toContain("영상 링크를 보냈어요");
    expect(draftNotification("feedback_item_done", { submission_id: "s2" }, who)).toMatchObject({ kind: "feedback_done", linkPath: "/dashboard/reviews/s2" });
  });

  it("대상이 아닌 이벤트나 링크 대상이 없는 이벤트는 알림을 만들지 않는다", () => {
    expect(draftNotification("guide_link_opened", { guide_id: "g1" }, who)).toBeNull();
    expect(draftNotification("upload_completed", { version: 1 }, who)).toBeNull();
  });
});

describe("안 읽은 수·상대 시간", () => {
  it("읽지 않은 항목만 센다", () => {
    expect(countUnread([{ read: true }, { read: false }, { read: false }])).toBe(2);
    expect(countUnread([])).toBe(0);
  });

  it("방금, 분, 시간, 일 단위로 보여 준다", () => {
    const t = Date.UTC(2026, 9, 27, 12);
    expect(relativeTime(t - 10_000, t)).toBe("방금");
    expect(relativeTime(t - 5 * 60_000, t)).toBe("5분 전");
    expect(relativeTime(t - 3 * 3_600_000, t)).toBe("3시간 전");
    expect(relativeTime(t - 2 * 86_400_000, t)).toBe("2일 전");
  });
});

type Inserted = { table: string; rows: unknown };

// 알림 한 건 조회만 흉내 낸 DB. found 가 그 알림의 워크스페이스
function fakeDb(found: { workspaceId: string } | undefined, inserted: Inserted[]): Db {
  const chain = { from: () => chain, where: () => chain, get: async () => found };
  const db = {
    select: () => chain,
    insert: (table: Table) => ({ values: (rows: unknown) => ({ onConflictDoNothing: async () => void inserted.push({ table: getTableName(table), rows }) }) }),
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

function readOne(found: { workspaceId: string } | undefined, inserted: Inserted[]) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", fakeDb(found, inserted));
    c.set("auth", auth);
    await next();
  });
  app.route("/api/notifications", notificationRoutes);
  app.onError((err, c) => (err instanceof ApiError ? c.json(errorBody(err.code, err.message, err.fields), err.status) : c.json({}, 500)));
  return app.request("/api/notifications/n1/read", { method: "POST" }, {});
}

describe("POST /api/notifications/:id/read", () => {
  it("다른 워크스페이스 알림은 404 이고 읽음을 남기지 않는다", async () => {
    const inserted: Inserted[] = [];
    expect((await readOne({ workspaceId: "w2" }, inserted)).status).toBe(404);
    expect((await readOne(undefined, inserted)).status).toBe(404);
    expect(inserted).toHaveLength(0);
  });

  it("내 워크스페이스 알림은 내 사용자 id 로 읽음을 남긴다", async () => {
    const inserted: Inserted[] = [];
    expect((await readOne({ workspaceId: "w1" }, inserted)).status).toBe(200);
    expect(inserted).toEqual([{ table: "notification_reads", rows: [expect.objectContaining({ notificationId: "n1", userId: "u1" })] }]);
  });
});
