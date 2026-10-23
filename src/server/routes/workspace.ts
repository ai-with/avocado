import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq, isNull, gt } from "drizzle-orm";
import type { AppEnv } from "../types";
import { invites, members, users, workspaces } from "../db/schema";
import { ApiError, parse } from "../lib/errors";
import { newId, newToken, now } from "../lib/ids";
import { logEvent } from "../lib/events";
import { sendEmail } from "../lib/email";
import { requireRole, workspaceCtx } from "../middleware/auth";
import { ROLE_LABELS } from "../../shared/roles";
import { onboardingSchema } from "../../shared/onboarding";

const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const assignableRole = z.enum(["editor", "approver", "viewer"]);
const ownerOnly = requireRole(["owner"]);

const inviteUrl = (env: Env, token: string) => `${env.APP_URL}/invite/${token}`;

export const workspaceRoutes = new Hono<AppEnv>()
  .patch("/", ownerOnly, async (c) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1, "이름을 입력해 주세요.").max(60) }), await c.req.json());
    const { workspace } = workspaceCtx(c);
    await c.var.db.update(workspaces).set({ name }).where(eq(workspaces.id, workspace.id));
    return c.json({ id: workspace.id, name });
  })
  // 첫 진입 설문. 건너뛰면 답은 남기지 않고 완료 시각만 기록한다
  .post("/onboarding", async (c) => {
    const body = parse(onboardingSchema, await c.req.json());
    const { workspace } = workspaceCtx(c);
    if (workspace.onboardedAt) throw new ApiError(409, "already_onboarded", "이미 온보딩을 마쳤습니다.");
    const skipped = body.skipped === true;
    const onboardedAt = now();
    await c.var.db.update(workspaces).set({ onboarding: skipped ? null : JSON.stringify(body), onboardedAt }).where(eq(workspaces.id, workspace.id));
    await logEvent(c.var.db, workspace.id, "onboarding_completed", { skipped });
    return c.json({ onboardedAt });
  })
  .get("/members", async (c) => {
    const { workspace, role } = workspaceCtx(c);
    const db = c.var.db;
    const list = await db
      .select({ userId: users.id, name: users.name, email: users.email, role: members.role, joinedAt: members.createdAt })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(members.workspaceId, workspace.id))
      .orderBy(asc(members.createdAt));
    const pending =
      role === "owner"
        ? (
            await db
              .select()
              .from(invites)
              .where(and(eq(invites.workspaceId, workspace.id), isNull(invites.acceptedAt), gt(invites.expiresAt, now())))
              .orderBy(asc(invites.createdAt))
          ).map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt, url: inviteUrl(c.env, i.token) }))
        : [];
    return c.json({ members: list, invites: pending });
  })
  .post("/invites", ownerOnly, async (c) => {
    const body = parse(
      z.object({ email: z.string().trim().toLowerCase().pipe(z.email("이메일 형식이 아닙니다.")), role: assignableRole }),
      await c.req.json(),
    );
    const { workspace, user } = workspaceCtx(c);
    const db = c.var.db;
    const already = await db
      .select({ id: users.id })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(and(eq(members.workspaceId, workspace.id), eq(users.email, body.email)))
      .get();
    if (already) throw new ApiError(409, "already_member", "이미 팀에 속한 이메일입니다.", { email: "이미 팀에 속한 이메일입니다." });

    const invite = { id: newId(), workspaceId: workspace.id, email: body.email, role: body.role, token: newToken(), invitedBy: user.id, expiresAt: now() + INVITE_MS, createdAt: now() };
    await db.insert(invites).values(invite);
    const url = inviteUrl(c.env, invite.token);
    const email = await sendEmail(c.env, {
      to: body.email,
      subject: `${workspace.name} 워크스페이스에 초대되었습니다`,
      text: `${user.name}님이 ${workspace.name} 워크스페이스에 ${ROLE_LABELS[body.role]}(으)로 초대했습니다.\n아래 링크에서 수락해 주세요. 링크는 7일 동안 유효합니다.\n${url}`,
      html: `<p>${escapeHtml(user.name)}님이 <b>${escapeHtml(workspace.name)}</b> 워크스페이스에 ${ROLE_LABELS[body.role]}(으)로 초대했습니다.</p><p><a href="${url}">초대 수락하기</a></p><p>링크는 7일 동안 유효합니다.</p>`,
    });
    await logEvent(db, workspace.id, "member_invited", { role: body.role, delivered: email.delivered });
    return c.json({ invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt, url }, email }, 201);
  })
  .delete("/invites/:id", ownerOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    await c.var.db.delete(invites).where(and(eq(invites.id, c.req.param("id")), eq(invites.workspaceId, workspace.id)));
    return c.json({ ok: true });
  })
  .patch("/members/:userId", ownerOnly, async (c) => {
    const { role } = parse(z.object({ role: assignableRole }), await c.req.json());
    const target = await findMember(c, c.req.param("userId"));
    await c.var.db.update(members).set({ role }).where(and(eq(members.workspaceId, target.workspaceId), eq(members.userId, target.userId)));
    return c.json({ userId: target.userId, role });
  })
  .delete("/members/:userId", ownerOnly, async (c) => {
    const target = await findMember(c, c.req.param("userId"));
    await c.var.db.delete(members).where(and(eq(members.workspaceId, target.workspaceId), eq(members.userId, target.userId)));
    await logEvent(c.var.db, target.workspaceId, "member_removed", { role: target.role });
    return c.json({ ok: true });
  });

// 소유자는 역할 변경·제거 대상이 아니다
async function findMember(c: Parameters<typeof workspaceCtx>[0], userId: string) {
  const { workspace } = workspaceCtx(c);
  const m = await c.var.db
    .select()
    .from(members)
    .where(and(eq(members.workspaceId, workspace.id), eq(members.userId, userId)))
    .get();
  if (!m) throw new ApiError(404, "member_not_found", "멤버를 찾을 수 없습니다.");
  if (m.role === "owner") throw new ApiError(400, "owner_locked", "소유자는 역할을 바꾸거나 제거할 수 없습니다.");
  return m;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
