import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { automations, documents, forms, guides } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, newToken, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { findOwned } from "../../lib/owned";
import { alimtalkConnected } from "../../lib/messaging";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { allPassed, type AutomationTarget } from "../../../shared/messaging";
import { channelSchema, checksFor, guardChannel, kindSchema, sendTest, templateSchema } from "./shared";
import { actorParams, actorSql, messageConfigured, messageCsrf, requireMessageCsrf, sqlAssertion } from "../../lib/message-delivery-common";
import { messageEngine } from "../../lib/message-engine";
import { messagePolicyStatus } from "../../lib/message-policy";

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
async function recentSends(db: Db, workspaceId: string) {
  return (await db.$client.prepare("SELECT source_id AS id,count(*) AS n FROM message_logs WHERE workspace_id=? AND source='automation' AND status='sent' AND at>? GROUP BY source_id").bind(workspaceId, now() - WEEK).all<{ id: string; n: number }>()).results;
}

export function createAutomationRoutes(engine = messageEngine) { return new Hono<AppEnv>()
  .use("*", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: { code: "message_body_large", message: "발송 내용이 커요. 내용을 줄여 주세요." } }, 413) }))
  .get("/", async (c) => {
    const auth = workspaceCtx(c), { workspace } = auth;
    const db = c.var.db;
    const rows = await db.select().from(automations).where(eq(automations.workspaceId, workspace.id)).orderBy(desc(automations.createdAt));
    const logs = await recentSends(db, workspace.id);
    return c.json({
      automations: rows.map((r) => ({ ...r, recentSent: logs.find((l) => l.id === r.id)?.n ?? 0 })),
      lookups: await lookups(db, workspace.id),
      alimtalkConnected: await alimtalkConnected(db, workspace.id),
      sendPolicy: messagePolicyStatus(), senderConfigured: messageConfigured(c.env), csrfToken: await messageCsrf(c.env, auth, workspace.id),
    });
  })
  .get("/:id", async (c) => {
    const { workspace } = workspaceCtx(c);
    return c.json({ automation: await ownAutomation(c.var.db, workspace.id, c.req.param("id")) });
  })
  .post("/", editorsOnly, async (c) => {
    const body = parse(automationSchema, await c.req.json());
    const auth = workspaceCtx(c), { workspace } = auth;
    const db = c.var.db;
    await requireMessageCsrf(c.env, auth, workspace.id, c.req.header("Origin"), c.req.header("X-CSRF-Token"), c.req.header("X-Message-Workspace"));
    await guardChannel(db, workspace.id, body.channel, body.template);
    const row = { id: newId(), workspaceId: workspace.id, ...body, generation: newToken(18), enabled: false, lastCheck: null, createdAt: now(), updatedAt: now() };
    try { await c.env.DB.batch([
      c.env.DB.prepare(sqlAssertion(actorSql)).bind(...actorParams(auth, workspace.id, now())),
      c.env.DB.prepare("INSERT INTO automations(id,workspace_id,name,trigger,target,delay_minutes,channel,kind,template,enabled,generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?)")
        .bind(row.id, workspace.id, body.name, body.trigger, JSON.stringify(body.target), body.delayMinutes, body.channel, body.kind, JSON.stringify(body.template), row.generation, row.createdAt, row.updatedAt),
    ]); } catch { throw new ApiError(409, "message_changed", "자동 발송 권한이나 워크스페이스가 바뀌었어요."); }
    await logEvent(db, workspace.id, "automation_created", { trigger: body.trigger, channel: body.channel, kind: body.kind });
    return c.json({ automation: row }, 201);
  })
  // 켜진 규칙을 고쳐 점검을 못 넘기면 꺼진 상태로 저장한다
  .patch("/:id", editorsOnly, async (c) => {
    const { expectedGeneration, ...body } = parse(automationSchema.extend({ expectedGeneration: z.string().min(1).max(100) }), await c.req.json());
    const auth = workspaceCtx(c), { workspace } = auth;
    const db = c.var.db;
    const prev = await ownAutomation(db, workspace.id, c.req.param("id"));
    await requireMessageCsrf(c.env, auth, workspace.id, c.req.header("Origin"), c.req.header("X-CSRF-Token"), c.req.header("X-Message-Workspace"));
    await guardChannel(db, workspace.id, body.channel, body.template);
    const ok = allPassed(await checksFor(db, workspace.id, body, hasTarget(body.target)));
    const enabled = prev.enabled && ok && engine.policyConfigured && messageConfigured(c.env), generation = newToken(18), at = now();
    try { await c.env.DB.batch([
      c.env.DB.prepare(sqlAssertion(`${actorSql} AND EXISTS(SELECT 1 FROM automations WHERE id=? AND workspace_id=? AND generation=?)`)).bind(...actorParams(auth, workspace.id, at), prev.id, workspace.id, expectedGeneration),
      c.env.DB.prepare("UPDATE automations SET name=?,trigger=?,target=?,delay_minutes=?,channel=?,kind=?,template=?,enabled=?,generation=?,authorized_by=?,authorization_generation=?,authorization_revoked_at=?,updated_at=? WHERE id=? AND workspace_id=? AND generation=?")
        .bind(body.name, body.trigger, JSON.stringify(body.target), body.delayMinutes, body.channel, body.kind, JSON.stringify(body.template), enabled ? 1 : 0, generation, auth.user.id, newToken(18), enabled ? null : at, at, prev.id, workspace.id, expectedGeneration),
    ]); } catch { throw new ApiError(409, "message_changed", "자동 발송 설정이나 권한이 바뀌었어요."); }
    return c.json({ automation: { ...prev, ...body, generation, enabled }, turnedOff: prev.enabled && !enabled });
  })
  .post("/:id/toggle", editorsOnly, async (c) => {
    const { enabled, expectedGeneration } = parse(z.object({ enabled: z.boolean(), expectedGeneration: z.string().min(1).max(100) }).strict(), await c.req.json());
    const auth = workspaceCtx(c), { workspace } = auth;
    await requireMessageCsrf(c.env, auth, workspace.id, c.req.header("Origin"), c.req.header("X-CSRF-Token"), c.req.header("X-Message-Workspace"));
    if (enabled) { engine.assertPolicy(); if (!messageConfigured(c.env)) throw new ApiError(503, "sender_not_configured", "실제 발신 설정을 준비하고 있어요."); }
    const db = c.var.db;
    const a = await ownAutomation(db, workspace.id, c.req.param("id"));
    const checks = await checksFor(db, workspace.id, a, hasTarget(a.target));
    const lastCheck = { ok: allPassed(checks), at: now(), failed: checks.filter((x) => !x.ok).map((x) => x.message) };
    if (enabled && !lastCheck.ok) {
      throw new ApiError(400, "check_failed", `켤 수 없어요. ${lastCheck.failed.join(" ")}`);
    }
    const generation = newToken(18), at = now();
    try { await c.env.DB.batch([
      c.env.DB.prepare(sqlAssertion(`${actorSql} AND EXISTS(SELECT 1 FROM automations WHERE id=? AND workspace_id=? AND generation=?)`)).bind(...actorParams(auth, workspace.id, at), a.id, workspace.id, expectedGeneration),
      c.env.DB.prepare("UPDATE automations SET enabled=?,last_check=?,generation=?,authorized_by=?,authorization_generation=?,authorization_revoked_at=?,updated_at=? WHERE id=? AND workspace_id=? AND generation=?")
        .bind(enabled ? 1 : 0, JSON.stringify(lastCheck), generation, auth.user.id, newToken(18), enabled ? null : at, at, a.id, workspace.id, expectedGeneration),
    ]); } catch { throw new ApiError(409, "message_changed", "자동 발송 상태나 권한이 바뀌었어요."); }
    await logEvent(db, workspace.id, "automation_toggled", { on: enabled });
    return c.json({ enabled, checks, generation });
  })
  .post("/:id/test", editorsOnly, async (c) => {
    const auth = workspaceCtx(c), { workspace } = auth;
    await requireMessageCsrf(c.env, auth, workspace.id, c.req.header("Origin"), c.req.header("X-CSRF-Token"), c.req.header("X-Message-Workspace"));
    return c.json(await sendTest(c, await ownAutomation(c.var.db, workspace.id, c.req.param("id"))));
  })
  .delete("/:id", editorsOnly, async (c) => {
    const auth = workspaceCtx(c), { workspace } = auth;
    const a = await ownAutomation(c.var.db, workspace.id, c.req.param("id"));
    await requireMessageCsrf(c.env, auth, workspace.id, c.req.header("Origin"), c.req.header("X-CSRF-Token"), c.req.header("X-Message-Workspace"));
    try { await c.env.DB.batch([
      c.env.DB.prepare(sqlAssertion(`${actorSql} AND EXISTS(SELECT 1 FROM automations WHERE id=? AND workspace_id=? AND generation=?)`)).bind(...actorParams(auth, workspace.id, now()), a.id, workspace.id, c.req.header("X-Message-Generation") ?? ""),
      c.env.DB.prepare("DELETE FROM automations WHERE id=? AND workspace_id=? AND generation=?").bind(a.id, workspace.id, c.req.header("X-Message-Generation") ?? ""),
    ]); } catch { throw new ApiError(409, "message_changed", "지울 수 있는 최신 규칙을 다시 확인해 주세요."); }
    return c.json({ ok: true });
  }); }
export const automationRoutes = createAutomationRoutes();
