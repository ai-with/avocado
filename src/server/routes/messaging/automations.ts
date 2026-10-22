import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { automations, documents, forms, guides, messageLogs } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { findOwned } from "../../lib/owned";
import { alimtalkConnected } from "../../lib/messaging";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { allPassed, type AutomationTarget } from "../../../shared/messaging";
import { channelSchema, checksFor, guardChannel, kindSchema, sendTest, templateSchema } from "./shared";

// 자동 발송 규칙 (F-66)

const WEEK = 7 * 24 * 60 * 60 * 1000;
const automationSchema = z.object({
  name: z.string().trim().min(1, "이름을 넣어 주세요.").max(80),
  trigger: z.enum(["form_submitted", "gate_passed", "document_completed"]),
  target: z.object({ formId: z.string().optional(), documentId: z.string().optional(), guideId: z.string().optional() }),
  delayMinutes: z.union([z.literal(0), z.literal(60), z.literal(1440), z.literal(4320)]),
  channel: channelSchema,
  kind: kindSchema,
  template: templateSchema,
});

const hasTarget = (t: AutomationTarget) => !!(t.formId || t.documentId || t.guideId);
const ownAutomation = (db: Db, workspaceId: string, id: string) => findOwned(db, automations, id, workspaceId, { code: "automation_not_found", message: "자동 발송 규칙을 찾을 수 없어요." });

async function lookups(db: Db, workspaceId: string) {
  const [f, d, g] = await Promise.all([
    db.select({ id: forms.id, name: forms.title }).from(forms).where(and(eq(forms.workspaceId, workspaceId), isNull(forms.deletedAt))),
    db.select({ id: documents.id, name: documents.title }).from(documents).where(and(eq(documents.workspaceId, workspaceId), isNull(documents.deletedAt))),
    db.select({ id: guides.id, name: guides.name }).from(guides).where(eq(guides.workspaceId, workspaceId)),
  ]);
  return { forms: f, documents: d, guides: g };
}

// 규칙별 최근 7일 발송 성공 기록
async function recentSends(db: Db, ids: string[]) {
  if (!ids.length) return [];
  return db
    .select({ sourceId: messageLogs.sourceId })
    .from(messageLogs)
    .where(and(inArray(messageLogs.sourceId, ids), eq(messageLogs.status, "sent"), gt(messageLogs.at, now() - WEEK)));
}

export const automationRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const rows = await db.select().from(automations).where(eq(automations.workspaceId, workspace.id)).orderBy(desc(automations.createdAt));
    const logs = await recentSends(db, rows.map((r) => r.id));
    return c.json({
      automations: rows.map((r) => ({ ...r, recentSent: logs.filter((l) => l.sourceId === r.id).length })),
      lookups: await lookups(db, workspace.id),
      alimtalkConnected: await alimtalkConnected(db, workspace.id),
    });
  })
  .get("/:id", async (c) => {
    const { workspace } = workspaceCtx(c);
    return c.json({ automation: await ownAutomation(c.var.db, workspace.id, c.req.param("id")) });
  })
  .post("/", editorsOnly, async (c) => {
    const body = parse(automationSchema, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    await guardChannel(db, workspace.id, body.channel, body.template);
    const row = { id: newId(), workspaceId: workspace.id, ...body, enabled: false, lastCheck: null, createdAt: now(), updatedAt: now() };
    await db.insert(automations).values(row);
    await logEvent(db, workspace.id, "automation_created", { trigger: body.trigger, channel: body.channel, kind: body.kind });
    return c.json({ automation: row }, 201);
  })
  // 켜진 규칙을 고쳐 점검을 못 넘기면 꺼진 상태로 저장한다
  .patch("/:id", editorsOnly, async (c) => {
    const body = parse(automationSchema, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const prev = await ownAutomation(db, workspace.id, c.req.param("id"));
    await guardChannel(db, workspace.id, body.channel, body.template);
    const ok = allPassed(await checksFor(db, workspace.id, body, hasTarget(body.target)));
    const enabled = prev.enabled && ok;
    await db.update(automations).set({ ...body, enabled, updatedAt: now() }).where(eq(automations.id, prev.id));
    return c.json({ automation: { ...prev, ...body, enabled }, turnedOff: prev.enabled && !enabled });
  })
  .post("/:id/toggle", editorsOnly, async (c) => {
    const { enabled } = parse(z.object({ enabled: z.boolean() }), await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const a = await ownAutomation(db, workspace.id, c.req.param("id"));
    const checks = await checksFor(db, workspace.id, a, hasTarget(a.target));
    const lastCheck = { ok: allPassed(checks), at: now(), failed: checks.filter((x) => !x.ok).map((x) => x.message) };
    if (enabled && !lastCheck.ok) {
      await db.update(automations).set({ lastCheck }).where(eq(automations.id, a.id));
      throw new ApiError(400, "check_failed", `켤 수 없어요. ${lastCheck.failed.join(" ")}`);
    }
    await db.update(automations).set({ enabled, lastCheck, updatedAt: now() }).where(eq(automations.id, a.id));
    await logEvent(db, workspace.id, "automation_toggled", { on: enabled });
    return c.json({ enabled, checks });
  })
  .post("/:id/test", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    return c.json(await sendTest(c, await ownAutomation(c.var.db, workspace.id, c.req.param("id"))));
  })
  .delete("/:id", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const a = await ownAutomation(c.var.db, workspace.id, c.req.param("id"));
    await c.var.db.delete(automations).where(eq(automations.id, a.id));
    return c.json({ ok: true });
  });
