import { Hono } from "hono";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import type { AppEnv } from "../types";
import type { Db } from "../db";
import { members, workspaces } from "../db/schema";
import { ApiError, parse } from "../lib/errors";
import { newId, now, sha256Hex } from "../lib/ids";
import { actorParams, assertSql, ensureSessionScope, sessionPredicate, workspaceChanged, writeUnavailable, type Actor } from "../lib/workspace-access";
import { requireAuth, requireAuthCtx, setCurrentWorkspace } from "../middleware/auth";

export function listWorkspaces(db: Db, userId: string) {
  return db.select({ id: workspaces.id, name: workspaces.name, plan: workspaces.plan, role: members.role })
    .from(members).innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(eq(members.userId, userId)).orderBy(asc(members.createdAt), asc(workspaces.id));
}
const createSchema = z.object({ expectedUserId: z.string().min(1).max(100), requestId: z.uuid(), workspaceName: z.string().trim().min(1, "이름을 입력해 주세요.").max(60), expectedWorkspaceId: z.string().min(1).max(100).nullable() }).strict();
async function replay(db: D1Database, actor: Actor, requestId: string, fingerprint: string) {
  const saved = await db.prepare(`SELECT r.fingerprint,r.state,r.session_id AS sessionId,r.workspace_id AS workspaceId,
    EXISTS(SELECT 1 FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=r.workspace_id AND m.user_id=r.user_id) AS accessible
    FROM workspace_creation_requests r WHERE r.user_id=? AND r.request_id=?`).bind(actor.user.id, requestId)
    .first<{ fingerprint: string; state: "created" | "cancelled"; sessionId: string; workspaceId: string | null; accessible: number }>();
  if (!saved) return null;
  if (saved.fingerprint !== fingerprint) throw new ApiError(409, "request_changed", "같은 요청의 내용이 달라졌어요. 이전 요청을 먼저 확인해 주세요.");
  if (saved.state === "cancelled") throw new ApiError(409, "request_cancelled", "워크스페이스가 바뀌어 생성하지 않았어요. 현재 화면에서 다시 만들어 주세요.");
  if (!saved.workspaceId || !saved.accessible) throw new ApiError(409, "workspace_unavailable", "이 요청으로 만든 워크스페이스를 더 이상 열 수 없어요.");
  const current = await ensureSessionScope(db, actor, undefined, now());
  return { workspaceId: saved.workspaceId, replayed: true, selected: saved.sessionId === actor.sessionId && current === saved.workspaceId };
}

export const workspacesRoutes = new Hono<AppEnv>()
  .use("*", async (c, next) => { c.header("Cache-Control", "no-store"); await next(); })
  .post("/", requireAuth, async (c) => {
    const actor = requireAuthCtx(c), body = parse(createSchema, await c.req.json()), db = c.env.DB;
    if (body.expectedUserId !== actor.user.id) throw new ApiError(409, "session_changed", "로그인한 계정이 바뀌었어요. 화면을 새로 확인해 주세요.");
    const fingerprint = await sha256Hex(JSON.stringify({ name: body.workspaceName, expectedWorkspaceId: body.expectedWorkspaceId }));
    try {
      const previous = await replay(db, actor, body.requestId, fingerprint);
      if (previous) return c.json(previous);
      const at = now();
      await ensureSessionScope(db, actor, body.expectedWorkspaceId, at);
      if ((actor.workspace?.id ?? null) !== body.expectedWorkspaceId) throw workspaceChanged();
      const workspaceId = newId(), brandId = newId();
      try {
        await db.batch([
          assertSql(db, sessionPredicate, actorParams(actor, body.expectedWorkspaceId, at)),
          db.prepare("INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)").bind(workspaceId, body.workspaceName, at),
          db.prepare("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES(?,?,'owner',?)").bind(workspaceId, actor.user.id, at),
          db.prepare("INSERT INTO brands(id,workspace_id,name,created_at) VALUES(?,?,?,?)").bind(brandId, workspaceId, body.workspaceName, at),
          db.prepare("INSERT INTO workspace_creation_requests(user_id,request_id,fingerprint,session_id,workspace_id,created_at) VALUES(?,?,?,?,?,?)")
            .bind(actor.user.id, body.requestId, fingerprint, actor.sessionId, workspaceId, at),
          db.prepare("UPDATE sessions SET current_workspace_id=? WHERE id=? AND user_id=?").bind(workspaceId, actor.sessionId, actor.user.id),
          db.prepare("INSERT INTO events(id,workspace_id,name,props,at) VALUES(?,?,'workspace_created','{}',?)").bind(newId(), workspaceId, at),
        ]);
      } catch {
        // A concurrent duplicate may have won. Read its result; never create or
        // reselect a second workspace after an ambiguous/duplicate outcome.
        const previous = await replay(db, actor, body.requestId, fingerprint);
        if (previous) return c.json(previous);
        await ensureSessionScope(db, actor, body.expectedWorkspaceId, at);
        throw writeUnavailable();
      }
      const current = await ensureSessionScope(db, actor, undefined, now());
      return c.json({ workspaceId, replayed: false, selected: current === workspaceId }, 201);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "workspace_changed") {
          try {
            const previous = await replay(db, actor, body.requestId, fingerprint);
            if (previous) return c.json(previous);
            // A terminal receipt prevents an older in-flight copy from committing
            // after the UI acknowledges this stale context and starts a new intent.
            await db.prepare(`INSERT INTO workspace_creation_requests(user_id,request_id,fingerprint,state,session_id,workspace_id,created_at)
              SELECT ?,?,?,'cancelled',?,NULL,? WHERE EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
                WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND u.phone_verified_at IS NOT NULL AND s.current_workspace_id IS NOT ?)
              ON CONFLICT(user_id,request_id) DO NOTHING`)
              .bind(actor.user.id, body.requestId, fingerprint, actor.sessionId, now(), actor.sessionId, actor.user.id, now(), body.expectedWorkspaceId).run();
            const settled = await replay(db, actor, body.requestId, fingerprint);
            if (settled) return c.json(settled);
          } catch (settlement) {
            if (settlement instanceof ApiError) throw settlement;
            console.error("[workspace_settlement_failed]", JSON.stringify({ failures: 1 }));
            throw writeUnavailable();
          }
        }
        throw error;
      }
      console.error("[workspace_create_failed]", JSON.stringify({ failures: 1 }));
      throw writeUnavailable();
    }
  })
  .post("/switch", requireAuth, async (c) => {
    const { workspaceId } = parse(z.object({ workspaceId: z.string().min(1) }), await c.req.json());
    await setCurrentWorkspace(c, workspaceId);
    return c.json({ workspaceId });
  });
