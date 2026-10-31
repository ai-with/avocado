import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { broadcasts } from "../../db/schema";
import { ApiError, errorBody, parse } from "../../lib/errors";
import { newId, newToken, now } from "../../lib/ids";
import { findOwned } from "../../lib/owned";
import { alimtalkConnected } from "../../lib/messaging";
import { countAudienceSummary } from "../../lib/lead-query";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { actorParams, actorSql, messageConfigured, messageCsrf, requireMessageCsrf, sqlAssertion } from "../../lib/message-delivery-common";
import { messageEngine } from "../../lib/message-engine";
import { messagePolicyStatus } from "../../lib/message-policy";
import { allPassed } from "../../../shared/messaging";
import { audienceSchema, channelSchema, checksFor, guardChannel, kindSchema, sendTest, templateSchema } from "./shared";

const draftSchema = z.object({ name: z.string().trim().max(80).default(""), channel: channelSchema.default("email"), kind: kindSchema.default("info"), audience: audienceSchema.default({ groupIds: [], tagIds: [] }), template: templateSchema.default({ subject: "", preview: "", body: "", buttonLabel: "", buttonUrl: "" }) });
const own = (db: Db, ws: string, id: string) => findOwned(db, broadcasts, id, ws, { code: "broadcast_not_found", message: "1회성 발송을 찾을 수 없어요." });
export function createBroadcastRoutes(engine = messageEngine) {
  return new Hono<AppEnv>()
    .use("*", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json(errorBody("message_body_large", "발송 내용이 커요. 내용을 줄여 주세요."), 413) }))
    .get("/", async (c) => {
      const auth = workspaceCtx(c), rows = await c.var.db.select().from(broadcasts).where(eq(broadcasts.workspaceId, auth.workspace.id)).orderBy(desc(broadcasts.createdAt));
      return c.json({ broadcasts: rows, alimtalkConnected: await alimtalkConnected(c.var.db, auth.workspace.id), sendPolicy: messagePolicyStatus(), senderConfigured: messageConfigured(c.env), csrfToken: await messageCsrf(c.env, auth, auth.workspace.id) });
    })
    .post("/audience", async (c) => {
      const input = parse(z.object({ audience: audienceSchema, channel: channelSchema, kind: kindSchema }), await c.req.json()), auth = workspaceCtx(c);
      return c.json(await countAudienceSummary(c.var.db, auth.workspace.id, input.audience, input.channel, input.kind));
    })
    .get("/:id", async (c) => { const auth = workspaceCtx(c); return c.json({ broadcast: await own(c.var.db, auth.workspace.id, c.req.param("id")) }); })
    .post("/", editorsOnly, async (c) => {
      const input = parse(draftSchema, await c.req.json()), auth = workspaceCtx(c), at = now(), id = newId(), generation = newToken(18);
      await requireMessageCsrf(c.env, auth, auth.workspace.id, c.req.header("Origin"), c.req.header("X-CSRF-Token"), c.req.header("X-Message-Workspace"));
      try { await c.env.DB.batch([
        c.env.DB.prepare(sqlAssertion(actorSql)).bind(...actorParams(auth, auth.workspace.id, at)),
        c.env.DB.prepare("INSERT INTO broadcasts(id,workspace_id,name,channel,kind,audience,template,status,generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'draft',?,?,?)")
          .bind(id, auth.workspace.id, input.name, input.channel, input.kind, JSON.stringify(input.audience), JSON.stringify(input.template), generation, at, at),
      ]); } catch { throw new ApiError(409, "message_changed", "발송 권한이나 워크스페이스가 바뀌었어요."); }
      return c.json({ broadcast: await own(c.var.db, auth.workspace.id, id) }, 201);
    })
    .patch("/:id", editorsOnly, async (c) => {
      const { expectedGeneration, ...input } = parse(draftSchema.extend({ expectedGeneration: z.string().min(1).max(100) }), await c.req.json()), auth = workspaceCtx(c), at = now(), generation = newToken(18);
      await requireMessageCsrf(c.env, auth, auth.workspace.id, c.req.header("Origin"), c.req.header("X-CSRF-Token"), c.req.header("X-Message-Workspace"));
      try { await c.env.DB.batch([
        c.env.DB.prepare(sqlAssertion(`${actorSql} AND EXISTS(SELECT 1 FROM broadcasts WHERE id=? AND workspace_id=? AND status='draft' AND generation=?)`)).bind(...actorParams(auth, auth.workspace.id, at), c.req.param("id"), auth.workspace.id, expectedGeneration),
        c.env.DB.prepare("UPDATE broadcasts SET name=?,channel=?,kind=?,audience=?,template=?,generation=?,active_run_id=NULL,stats=NULL,delivery_state=NULL,updated_at=? WHERE id=? AND workspace_id=? AND status='draft' AND generation=?")
          .bind(input.name, input.channel, input.kind, JSON.stringify(input.audience), JSON.stringify(input.template), generation, at, c.req.param("id"), auth.workspace.id, expectedGeneration),
      ]); } catch { throw new ApiError(409, "message_changed", "발송 초안이 바뀌었어요. 다시 열어 주세요."); }
      return c.json({ updatedAt: at, generation });
    })
    .post("/:id/test", editorsOnly, async (c) => {
      const auth = workspaceCtx(c); await requireMessageCsrf(c.env, auth, auth.workspace.id, c.req.header("Origin"), c.req.header("X-CSRF-Token"), c.req.header("X-Message-Workspace")); return c.json(await sendTest(c, await own(c.var.db, auth.workspace.id, c.req.param("id"))));
    })
    .post("/:id/send", editorsOnly, async (c) => {
      const input = parse(z.object({ requestId: z.uuid(), generation: z.string().min(1).max(100), scheduledAt: z.number().int().nullable().default(null) }).strict(), await c.req.json());
      const auth = workspaceCtx(c); await requireMessageCsrf(c.env, auth, auth.workspace.id, c.req.header("Origin"), c.req.header("X-CSRF-Token"), c.req.header("X-Message-Workspace"));
      engine.assertPolicy();
      const b = await own(c.var.db, auth.workspace.id, c.req.param("id"));
      let recipients = b.stats?.eligible ?? 0;
      if (b.status === "draft") {
        await guardChannel(c.var.db, auth.workspace.id, b.channel, b.template);
        const checks = await checksFor(c.var.db, auth.workspace.id, b, b.audience.groupIds.length + b.audience.tagIds.length > 0);
        if (!allPassed(checks)) throw new ApiError(400, "check_failed", "발송 전 점검을 확인해 주세요.");
        if (!messageConfigured(c.env)) throw new ApiError(503, "sender_not_configured", "실제 발신 설정을 준비하고 있어요.");
        recipients = (await countAudienceSummary(c.var.db, auth.workspace.id, b.audience, b.channel, b.kind)).eligible;
        if (!recipients) throw new ApiError(400, "no_recipients", "발송 가능한 받는 사람이 없어요.");
      } else if (b.activeRunId !== input.requestId) throw new ApiError(409, "message_changed", "이미 예약되었거나 처리한 발송이에요.");
      const result = await engine.requestBroadcast(c.env, auth, auth.workspace.id, b.id, input);
      return c.json({ ...result, recipients });
    })
    .post("/:id/cancel", editorsOnly, async (c) => {
      const input = parse(z.object({ generation: z.string().min(1).max(100) }).strict(), await c.req.json()), auth = workspaceCtx(c);
      await requireMessageCsrf(c.env, auth, auth.workspace.id, c.req.header("Origin"), c.req.header("X-CSRF-Token"), c.req.header("X-Message-Workspace"));
      return c.json(await engine.cancelBroadcast(c.env, auth, auth.workspace.id, c.req.param("id"), input.generation));
    })
    .delete("/:id", editorsOnly, async (c) => {
      const auth = workspaceCtx(c), generation = c.req.header("X-Message-Generation");
      await requireMessageCsrf(c.env, auth, auth.workspace.id, c.req.header("Origin"), c.req.header("X-CSRF-Token"), c.req.header("X-Message-Workspace"));
      try { await c.env.DB.batch([
        c.env.DB.prepare(sqlAssertion(`${actorSql} AND EXISTS(SELECT 1 FROM broadcasts WHERE id=? AND workspace_id=? AND status='draft' AND generation=?)`)).bind(...actorParams(auth, auth.workspace.id, now()), c.req.param("id"), auth.workspace.id, generation ?? ""),
        c.env.DB.prepare("DELETE FROM broadcasts WHERE id=? AND workspace_id=? AND status='draft' AND generation=?").bind(c.req.param("id"), auth.workspace.id, generation ?? ""),
      ]); } catch { throw new ApiError(409, "message_changed", "지울 수 있는 최신 초안을 다시 확인해 주세요."); }
      return c.json({ ok: true });
    });
}
export const broadcastRoutes = createBroadcastRoutes();
