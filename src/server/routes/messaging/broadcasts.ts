import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { broadcasts } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { findOwned } from "../../lib/owned";
import { alimtalkConnected, countAudience, runBroadcast } from "../../lib/messaging";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { allPassed } from "../../../shared/messaging";
import { audienceSchema, channelSchema, checksFor, guardChannel, kindSchema, sendTest, templateSchema } from "./shared";

// 1회성 발송 (F-67)

// 이보다 가까운 예약은 지금 보낸다
const SCHEDULE_MIN_LEAD_MS = 60_000;
const broadcastSchema = z.object({
  name: z.string().trim().max(80).default(""),
  channel: channelSchema.default("email"),
  kind: kindSchema.default("info"),
  audience: audienceSchema.default({ groupIds: [], tagIds: [] }),
  template: templateSchema.default({ subject: "", preview: "", body: "", buttonLabel: "", buttonUrl: "" }),
});
type Broadcast = typeof broadcasts.$inferSelect;

const ownBroadcast = (db: Db, workspaceId: string, id: string) => findOwned(db, broadcasts, id, workspaceId, { code: "broadcast_not_found", message: "1회성 발송을 찾을 수 없어요." });

const draftOnly = (b: { status: string }) => {
  if (b.status !== "draft") throw new ApiError(409, "not_draft", "이미 보냈거나 예약된 발송은 고칠 수 없어요. 예약이면 먼저 취소해 주세요.");
};

// 보내기 전 점검과 받는 사람 수. 못 보내면 400
async function assertSendable(db: Db, workspaceId: string, b: Broadcast) {
  draftOnly(b);
  await guardChannel(db, workspaceId, b.channel, b.template);
  const targetOk = b.audience.groupIds.length + b.audience.tagIds.length > 0;
  const checks = await checksFor(db, workspaceId, b, targetOk);
  if (!allPassed(checks)) throw new ApiError(400, "check_failed", `보낼 수 없어요. ${checks.filter((x) => !x.ok).map((x) => x.message).join(" ")}`);
  const { eligible } = await countAudience(db, workspaceId, b.audience, b.channel, b.kind);
  if (eligible.length === 0) throw new ApiError(400, "no_recipients", "발송 가능한 받는 사람이 없어요.");
  return eligible.length;
}

export const broadcastRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const rows = await c.var.db.select().from(broadcasts).where(eq(broadcasts.workspaceId, workspace.id)).orderBy(desc(broadcasts.createdAt));
    return c.json({ broadcasts: rows, alimtalkConnected: await alimtalkConnected(c.var.db, workspace.id) });
  })
  // 받는 사람 실시간 집계. 화면이 그룹·태그·채널·성격을 바꿀 때마다 부른다
  .post("/audience", async (c) => {
    const body = parse(z.object({ audience: audienceSchema, channel: channelSchema, kind: kindSchema }), await c.req.json());
    const { workspace } = workspaceCtx(c);
    const r = await countAudience(c.var.db, workspace.id, body.audience, body.channel, body.kind);
    return c.json({ total: r.total, eligible: r.eligible.length, reasons: r.reasons });
  })
  .get("/:id", async (c) => {
    const { workspace } = workspaceCtx(c);
    return c.json({ broadcast: await ownBroadcast(c.var.db, workspace.id, c.req.param("id")) });
  })
  .post("/", editorsOnly, async (c) => {
    const body = parse(broadcastSchema, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const row = { id: newId(), workspaceId: workspace.id, ...body, status: "draft" as const, scheduledAt: null, sentAt: null, stats: null, createdAt: now(), updatedAt: now() };
    await c.var.db.insert(broadcasts).values(row);
    await logEvent(c.var.db, workspace.id, "broadcast_created", { channel: body.channel, kind: body.kind });
    return c.json({ broadcast: row }, 201);
  })
  // 자동 임시저장(5초 디바운스)이 부른다. 알림톡도 임시저장은 받되 보내기에서 막는다
  .patch("/:id", editorsOnly, async (c) => {
    const body = parse(broadcastSchema, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const b = await ownBroadcast(c.var.db, workspace.id, c.req.param("id"));
    draftOnly(b);
    const updatedAt = now();
    await c.var.db.update(broadcasts).set({ ...body, updatedAt }).where(eq(broadcasts.id, b.id));
    return c.json({ updatedAt });
  })
  .post("/:id/test", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const r = await sendTest(c, await ownBroadcast(c.var.db, workspace.id, c.req.param("id")));
    await logEvent(c.var.db, workspace.id, "broadcast_test_sent", { delivered: r.delivered });
    return c.json(r);
  })
  // 매번 브랜드가 누른다(4-2). scheduledAt 이 미래면 예약, 아니면 지금 보낸다
  .post("/:id/send", editorsOnly, async (c) => {
    const { scheduledAt } = parse(z.object({ scheduledAt: z.number().int().nullable().default(null) }), await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const b = await ownBroadcast(db, workspace.id, c.req.param("id"));
    const recipients = await assertSendable(db, workspace.id, b);
    const later = !!scheduledAt && scheduledAt > now() + SCHEDULE_MIN_LEAD_MS;
    await db.update(broadcasts).set({ status: "scheduled", scheduledAt: later ? scheduledAt : now(), updatedAt: now() }).where(eq(broadcasts.id, b.id));
    if (!later) c.executionCtx.waitUntil(runBroadcast(c.env, db, b.id).catch((e: unknown) => console.error("[broadcast]", e)));
    return c.json({ status: "scheduled", scheduledAt: later ? scheduledAt : now(), recipients });
  })
  .post("/:id/cancel", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const b = await ownBroadcast(c.var.db, workspace.id, c.req.param("id"));
    if (b.status !== "scheduled") throw new ApiError(409, "not_scheduled", "예약된 발송만 취소할 수 있어요.");
    await c.var.db.update(broadcasts).set({ status: "draft", scheduledAt: null }).where(and(eq(broadcasts.id, b.id), eq(broadcasts.status, "scheduled")));
    return c.json({ ok: true });
  })
  .delete("/:id", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const b = await ownBroadcast(c.var.db, workspace.id, c.req.param("id"));
    draftOnly(b);
    await c.var.db.delete(broadcasts).where(eq(broadcasts.id, b.id));
    return c.json({ ok: true });
  });
