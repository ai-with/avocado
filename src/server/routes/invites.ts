import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv, AuthUser } from "../types";
import type { Db } from "../db";
import { invites, workspaces } from "../db/schema";
import { ApiError } from "../lib/errors";
import { newId, now } from "../lib/ids";
import { assertSql, inviteAuthority, writeUnavailable, type Actor } from "../lib/workspace-access";
import { requireAuth, requireAuthCtx, setCurrentWorkspace } from "../middleware/auth";

const unavailableInvite = () => new ApiError(410, "invite_unavailable", "더 이상 사용할 수 없는 초대예요. 관리자에게 다시 요청해 주세요.");
async function findValidInvite(db: Db, token: string) {
  try {
    const row = await db.select({ invite: invites, workspaceName: workspaces.name }).from(invites)
      .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId)).where(eq(invites.token, token)).get();
    if (!row) throw new ApiError(404, "invite_not_found", "초대 링크를 찾을 수 없어요.");
    if (row.invite.acceptedAt !== null) throw new ApiError(410, "invite_used", "이미 사용된 초대 링크예요.");
    if (row.invite.expiresAt <= now()) throw new ApiError(410, "invite_expired", "만료된 초대 링크예요. 관리자에게 다시 요청해 주세요.");
    const active = await db.$client.prepare(`SELECT i.id FROM invites i WHERE i.id=? AND ${inviteAuthority()}`).bind(row.invite.id).first();
    if (!active) throw unavailableInvite();
    return row;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("[invite_lookup_failed]", JSON.stringify({ failures: 1 }));
    throw writeUnavailable();
  }
}
export async function checkInvite(db: Db, token: string, email: string) {
  const { invite } = await findValidInvite(db, token);
  if (invite.email.trim().toLowerCase() !== email.trim().toLowerCase()) throw new ApiError(403, "invite_email_mismatch", `초대받은 이메일(${invite.email})로 진행해 주세요.`);
  return invite;
}

// Signup has no session yet; authenticated accept additionally fences its live
// session/phone authority. Both callers consume the same atomic token predicate.
export async function acceptInvite(db: Db, token: string, user: AuthUser, actor?: Actor): Promise<string> {
  const invite = await checkInvite(db, token, user.email), d1 = db.$client, at = now(), email = user.email.trim().toLowerCase();
  const session = actor ? ` AND EXISTS(SELECT 1 FROM sessions s JOIN users target ON target.id=s.user_id WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND target.phone_verified_at IS NOT NULL)` : "";
  const predicate = `i.id=? AND i.token=? AND lower(trim(i.email))=? AND i.accepted_at IS NULL AND i.expires_at>?
    AND ${inviteAuthority()} AND EXISTS(SELECT 1 FROM users target WHERE target.id=? AND lower(trim(target.email))=?)${session}`;
  const params = [invite.id, token, email, at, user.id, email, ...(actor ? [actor.sessionId, user.id, at] : [])];
  try {
    await d1.batch([
      assertSql(d1, `EXISTS(SELECT 1 FROM invites i WHERE ${predicate})`, params),
      d1.prepare(`INSERT INTO members(workspace_id,user_id,role,created_at) SELECT i.workspace_id,?,i.role,? FROM invites i WHERE ${predicate}
        ON CONFLICT(workspace_id,user_id) DO NOTHING`).bind(user.id, at, ...params),
      d1.prepare(`UPDATE invites AS i SET accepted_at=? WHERE ${predicate}
        AND EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=i.workspace_id AND m.user_id=?)`).bind(at, ...params, user.id),
      d1.prepare("INSERT INTO events(id,workspace_id,name,props,at) SELECT ?,i.workspace_id,'invite_accepted',json_object('role',i.role),? FROM invites i WHERE i.id=? AND changes()=1").bind(newId(), at, invite.id),
    ]);
  } catch {
    // Re-read only for a safe classification, never replay a stale invitation.
    await checkInvite(db, token, user.email);
    if (actor) {
      const active = await d1.prepare("SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND u.phone_verified_at IS NOT NULL").bind(actor.sessionId, user.id, now()).first();
      if (!active) throw new ApiError(401, "unauthorized", "로그인이 필요해요.");
    }
    console.error("[invite_accept_failed]", JSON.stringify({ failures: 1 }));
    throw writeUnavailable();
  }
  return invite.workspaceId;
}

export const inviteRoutes = new Hono<AppEnv>()
  .use("*", async (c, next) => { c.header("Cache-Control", "no-store"); await next(); })
  .get("/:token", async (c) => {
    const { invite, workspaceName } = await findValidInvite(c.var.db, c.req.param("token"));
    return c.json({ workspaceName, email: invite.email, role: invite.role, expiresAt: invite.expiresAt });
  })
  .post("/:token/accept", requireAuth, async (c) => {
    const actor = requireAuthCtx(c);
    const workspaceId = await acceptInvite(c.var.db, c.req.param("token"), actor.user, actor);
    await setCurrentWorkspace(c, workspaceId);
    return c.json({ workspaceId });
  });
