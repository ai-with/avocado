import { Hono } from "hono";
import { z } from "zod";
import { desc, eq, inArray } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { automations, broadcasts, leads, messageLogs, workspaces } from "../../db/schema";
import { parse } from "../../lib/errors";
import { findOwned } from "../../lib/owned";
import { alimtalkConnected } from "../../lib/messaging";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";

// 발신 정보 설정, 리드 드로어의 발송 기록

const LOG_LIMIT = 100;

// 발송 기록의 출처 이름 (자동 발송 규칙 또는 1회성 발송)
async function sourceNames(db: Db, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const [a, b] = await Promise.all([
    db.select({ id: automations.id, name: automations.name }).from(automations).where(inArray(automations.id, ids)),
    db.select({ id: broadcasts.id, name: broadcasts.name }).from(broadcasts).where(inArray(broadcasts.id, ids)),
  ]);
  return new Map([...a, ...b].map((x) => [x.id, x.name]));
}

export const messagingRoutes = new Hono<AppEnv>()
  .get("/settings", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const w = await db.select({ senderName: workspaces.senderName, senderContact: workspaces.senderContact }).from(workspaces).where(eq(workspaces.id, workspace.id)).get();
    return c.json({
      senderName: w?.senderName ?? "",
      senderContact: w?.senderContact ?? "",
      workspaceName: workspace.name,
      fromAddress: c.env.EMAIL_FROM || "no-reply@example.com",
      alimtalk: { status: (await alimtalkConnected(db, workspace.id)) ? "connected" : "not_connected" },
    });
  })
  .patch("/settings", editorsOnly, async (c) => {
    const body = parse(z.object({ senderName: z.string().trim().max(60), senderContact: z.string().trim().max(120) }), await c.req.json());
    const { workspace } = workspaceCtx(c);
    await c.var.db.update(workspaces).set({ senderName: body.senderName || null, senderContact: body.senderContact || null }).where(eq(workspaces.id, workspace.id));
    return c.json(body);
  })
  .get("/leads/:id/logs", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const lead = await findOwned(db, leads, c.req.param("id"), workspace.id, { code: "lead_not_found", message: "리드를 찾을 수 없어요." });
    const logs = await db.select().from(messageLogs).where(eq(messageLogs.leadId, lead.id)).orderBy(desc(messageLogs.at)).limit(LOG_LIMIT);
    const names = await sourceNames(db, [...new Set(logs.map((l) => l.sourceId))]);
    return c.json({ logs: logs.map((l) => ({ id: l.id, source: l.source, sourceName: names.get(l.sourceId) ?? "삭제된 발송", channel: l.channel, status: l.status, reason: l.reason, at: l.at })) });
  });
