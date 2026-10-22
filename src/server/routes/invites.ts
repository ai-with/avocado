import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv, AuthUser } from "../types";
import type { Db } from "../db";
import { invites, members, workspaces } from "../db/schema";
import { ApiError } from "../lib/errors";
import { now } from "../lib/ids";
import { logEvent } from "../lib/events";
import { requireAuth, requireAuthCtx, setCurrentWorkspace } from "../middleware/auth";

async function findValidInvite(db: Db, token: string) {
  const row = await db
    .select({ invite: invites, workspaceName: workspaces.name })
    .from(invites)
    .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
    .where(eq(invites.token, token))
    .get();
  if (!row) throw new ApiError(404, "invite_not_found", "초대 링크를 찾을 수 없습니다.");
  if (row.invite.acceptedAt) throw new ApiError(410, "invite_used", "이미 사용된 초대 링크입니다.");
  if (row.invite.expiresAt < now()) throw new ApiError(410, "invite_expired", "만료된 초대 링크입니다. 관리자에게 다시 요청해 주세요.");
  return row;
}

// 초대받은 이메일과 계정 이메일이 같아야 한다
export async function checkInvite(db: Db, token: string, email: string) {
  const { invite } = await findValidInvite(db, token);
  if (invite.email !== email) {
    throw new ApiError(403, "invite_email_mismatch", `초대받은 이메일(${invite.email})로 진행해 주세요.`);
  }
  return invite;
}

// 가입(signup)과 수락(accept) 양쪽에서 쓴다
export async function acceptInvite(db: Db, token: string, user: AuthUser): Promise<string> {
  const invite = await checkInvite(db, token, user.email);
  await db.batch([
    db
      .insert(members)
      .values({ workspaceId: invite.workspaceId, userId: user.id, role: invite.role, createdAt: now() })
      .onConflictDoNothing(),
    db.update(invites).set({ acceptedAt: now() }).where(eq(invites.id, invite.id)),
  ]);
  await logEvent(db, invite.workspaceId, "invite_accepted", { role: invite.role });
  return invite.workspaceId;
}

export const inviteRoutes = new Hono<AppEnv>()
  .get("/:token", async (c) => {
    const { invite, workspaceName } = await findValidInvite(c.var.db, c.req.param("token"));
    return c.json({ workspaceName, email: invite.email, role: invite.role, expiresAt: invite.expiresAt });
  })
  .post("/:token/accept", requireAuth, async (c) => {
    const workspaceId = await acceptInvite(c.var.db, c.req.param("token"), requireAuthCtx(c).user);
    await setCurrentWorkspace(c, workspaceId);
    return c.json({ workspaceId });
  });
