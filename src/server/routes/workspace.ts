import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import type { Role } from "../../shared/roles";
import { INVITABLE_ROLES, ROLE_LABELS, ROLES, WORKSPACE_ROLES, canInviteMembers } from "../../shared/roles";
import { withJosa } from "../../shared/josa";
import { onboardingSchema } from "../../shared/onboarding";
import { ApiError, parse } from "../lib/errors";
import { newId, newToken, now } from "../lib/ids";
import { sendEmail, type EmailResult } from "../lib/email";
import { actorParams, assertSql, authorityPredicate, ensureWorkspaceRole, inviteAuthority, workspaceChanged, writeUnavailable } from "../lib/workspace-access";
import { requireRole, workspaceCtx } from "../middleware/auth";

const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const expected = z.string().min(1).max(100);
const assignableRole = z.enum(INVITABLE_ROLES);
const ownerOnly = requireRole([...WORKSPACE_ROLES.manage]);
const inviterOnly = requireRole([...WORKSPACE_ROLES.invite]);
const inviteUrl = (env: Env, token: string) => `${env.APP_URL}/invite/${token}`;
const expectedAccount = (c: Context<AppEnv>, userId?: string) => { if (userId && workspaceCtx(c).user.id !== userId) throw new ApiError(409, "session_changed", "로그인한 계정이 바뀌었어요. 화면을 새로 확인해 주세요."); };
const missingInvite = () => new ApiError(404, "invite_not_found", "초대 링크를 찾을 수 없어요.");

async function authorized(c: Context<AppEnv>, workspaceId: string, roles: readonly Role[], statements: D1PreparedStatement[]) {
  const actor = workspaceCtx(c), at = now();
  if (actor.workspace.id !== workspaceId) throw workspaceChanged();
  await ensureWorkspaceRole(c.env.DB, actor, workspaceId, roles, at);
  try {
    return await c.env.DB.batch([assertSql(c.env.DB, authorityPredicate(roles), actorParams(actor, workspaceId, at)), ...statements]);
  } catch {
    await ensureWorkspaceRole(c.env.DB, actor, workspaceId, roles, now());
    console.error("[workspace_write_failed]", JSON.stringify({ failures: 1 }));
    throw writeUnavailable();
  }
}

export const workspaceRoutes = new Hono<AppEnv>()
  .use("*", async (c, next) => { c.header("Cache-Control", "no-store"); await next(); })
  .patch("/", ownerOnly, async (c) => {
    const { name, expectedWorkspaceId } = parse(z.object({ name: z.string().trim().min(1, "이름을 입력해 주세요.").max(60), expectedWorkspaceId: expected }).strict(), await c.req.json());
    await authorized(c, expectedWorkspaceId, WORKSPACE_ROLES.manage, [c.env.DB.prepare("UPDATE workspaces SET name=? WHERE id=?").bind(name, expectedWorkspaceId)]);
    return c.json({ id: expectedWorkspaceId, name });
  })
  .post("/onboarding", ownerOnly, async (c) => {
    const { expectedWorkspaceId, expectedUserId, ...body } = parse(onboardingSchema.extend({ expectedWorkspaceId: expected, expectedUserId: expected.optional() }).strict(), await c.req.json());
    expectedAccount(c, expectedUserId);
    const at = now(), skipped = body.skipped === true, db = c.env.DB;
    const result = await authorized(c, expectedWorkspaceId, WORKSPACE_ROLES.survey, [
      db.prepare("UPDATE workspaces SET onboarding=?,onboarded_at=? WHERE id=? AND onboarded_at IS NULL RETURNING onboarded_at")
        .bind(skipped ? null : JSON.stringify(body), at, expectedWorkspaceId),
      // changes() belongs to the immediately preceding CAS in the same batch.
      db.prepare("INSERT INTO events(id,workspace_id,name,props,at) SELECT ?,?,'onboarding_completed',?,? WHERE changes()=1")
        .bind(newId(), expectedWorkspaceId, JSON.stringify({ skipped }), at),
    ]);
    if (result[1]!.meta.changes !== 1) throw new ApiError(409, "already_onboarded", "이미 온보딩을 마쳤어요.");
    return c.json({ onboardedAt: at });
  })
  .post("/onboarding/skip", requireRole([...WORKSPACE_ROLES.skip]), async (c) => {
    const { expectedWorkspaceId, expectedUserId } = parse(z.object({ expectedWorkspaceId: expected, expectedUserId: expected.optional() }).strict(), await c.req.json());
    expectedAccount(c, expectedUserId);
    const actor = workspaceCtx(c), at = now(), db = c.env.DB;
    await authorized(c, expectedWorkspaceId, WORKSPACE_ROLES.skip, [db.prepare("UPDATE members SET onboarding_skipped_at=coalesce(onboarding_skipped_at,?) WHERE workspace_id=? AND user_id=?")
      .bind(at, expectedWorkspaceId, actor.user.id)]);
    const row = await db.prepare("SELECT onboarding_skipped_at AS skippedAt FROM members WHERE workspace_id=? AND user_id=?").bind(expectedWorkspaceId, actor.user.id).first<{ skippedAt: number }>();
    return c.json({ skippedAt: row?.skippedAt ?? at });
  })
  .get("/members", async (c) => {
    const actor = workspaceCtx(c), id = actor.workspace.id, db = c.env.DB, at = now();
    const role = await ensureWorkspaceRole(db, actor, id, ROLES, at);
    const list = await db.prepare(`SELECT u.id AS userId,u.name,u.email,m.role,m.created_at AS joinedAt FROM members m JOIN users u ON u.id=m.user_id
      WHERE m.workspace_id=? AND ${authorityPredicate(ROLES)} ORDER BY m.created_at,u.id`).bind(id, ...actorParams(actor, id, at)).all();
    const pending = canInviteMembers(role) ? await db.prepare(`SELECT i.id,i.email,i.role,i.expires_at AS expiresAt,i.token FROM invites i
      WHERE i.workspace_id=? AND i.accepted_at IS NULL AND i.expires_at>?
      AND ${authorityPredicate(role === "owner" ? WORKSPACE_ROLES.manage : WORKSPACE_ROLES.invite)}
      AND (?='owner' OR i.invited_by=?) ORDER BY i.created_at,i.id`)
      .bind(id, at, ...actorParams(actor, id, at), role, actor.user.id).all<{ id: string; email: string; role: Role; expiresAt: number; token: string }>() : { results: [] };
    return c.json({ workspaceId: id, members: list.results, invites: pending.results.map(({ token, ...invite }) => ({ ...invite, url: inviteUrl(c.env, token) })) });
  })
  .post("/invites", inviterOnly, async (c) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().pipe(z.email("이메일 형식이 아니에요.")), role: assignableRole, expectedWorkspaceId: expected, expectedUserId: expected.optional() }).strict(), await c.req.json());
    expectedAccount(c, body.expectedUserId);
    const actor = workspaceCtx(c), db = c.env.DB, at = now(), id = newId(), token = newToken(), eventId = newId();
    const result = await authorized(c, body.expectedWorkspaceId, WORKSPACE_ROLES.invite, [
      db.prepare(`INSERT INTO invites(id,workspace_id,email,role,token,invited_by,issuer_required,expires_at,created_at)
        SELECT ?,?,?,?,?,?,1,?,? WHERE NOT EXISTS(SELECT 1 FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND lower(trim(u.email))=?)`)
        .bind(id, body.expectedWorkspaceId, body.email, body.role, token, actor.user.id, at + INVITE_MS, at, body.expectedWorkspaceId, body.email),
      db.prepare("INSERT INTO events(id,workspace_id,name,props,at) SELECT ?,?,'member_invited',?,? WHERE changes()=1")
        .bind(eventId, body.expectedWorkspaceId, JSON.stringify({ role: body.role, delivered: false }), at),
    ]);
    if (result[1]!.meta.changes !== 1) throw new ApiError(409, "already_member", "이미 팀에 속한 이메일이에요.", { email: "이미 팀에 속한 이메일이에요." });
    await ensureWorkspaceRole(db, actor, body.expectedWorkspaceId, WORKSPACE_ROLES.invite, now());
    const live = await db.prepare(`SELECT i.id FROM invites i WHERE i.id=? AND i.workspace_id=? AND i.accepted_at IS NULL AND i.expires_at>? AND ${inviteAuthority()}`)
      .bind(id, body.expectedWorkspaceId, now()).first();
    if (!live) throw missingInvite();
    const url = inviteUrl(c.env, token);
    let email: EmailResult = { delivered: false, reason: "no_provider" };
    if (c.env.RESEND_API_KEY?.trim() && c.env.EMAIL_FROM?.trim()) {
      try {
        email = await sendEmail(c.env, {
          to: body.email, subject: `${actor.workspace.name} 워크스페이스에 초대되었어요`,
          text: `${actor.user.name}님이 ${actor.workspace.name} 워크스페이스에 ${withJosa(ROLE_LABELS[body.role], "으로/로")} 초대했어요.\n아래 링크에서 수락해 주세요. 링크는 7일 동안 쓸 수 있어요.\n${url}`,
          html: `<p>${escapeHtml(actor.user.name)}님이 <b>${escapeHtml(actor.workspace.name)}</b> 워크스페이스에 ${withJosa(ROLE_LABELS[body.role], "으로/로")} 초대했어요.</p><p><a href="${url}">초대 수락하기</a></p><p>링크는 7일 동안 쓸 수 있어요.</p>`,
        }, { from: c.env.EMAIL_FROM.trim(), timeoutMs: 10_000, logProviderErrors: false });
      } catch { email = { delivered: false, reason: "provider_error" }; }
      try { await db.prepare("UPDATE events SET props=? WHERE id=? AND workspace_id=?").bind(JSON.stringify({ role: body.role, delivered: email.delivered }), eventId, body.expectedWorkspaceId).run(); }
      catch { console.error("[invite_mail_log_failed]", JSON.stringify({ failures: 1 })); }
    }
    return c.json({ invite: { id, email: body.email, role: body.role, expiresAt: at + INVITE_MS, url }, email }, 201);
  })
  .delete("/invites/:id", inviterOnly, async (c) => {
    const expectedWorkspaceId = parse(expected, c.req.query("expectedWorkspaceId")), actor = workspaceCtx(c);
    const result = await authorized(c, expectedWorkspaceId, WORKSPACE_ROLES.invite, [c.env.DB.prepare(`DELETE FROM invites WHERE id=? AND workspace_id=? AND accepted_at IS NULL
      AND (invited_by=? OR EXISTS(SELECT 1 FROM members WHERE workspace_id=? AND user_id=? AND role='owner'))`)
      .bind(c.req.param("id"), expectedWorkspaceId, actor.user.id, expectedWorkspaceId, actor.user.id)]);
    if (result[1]!.meta.changes !== 1) throw missingInvite();
    return c.json({ ok: true });
  })
  .patch("/members/:userId", ownerOnly, async (c) => {
    const { role, expectedWorkspaceId } = parse(z.object({ role: assignableRole, expectedWorkspaceId: expected }).strict(), await c.req.json());
    const db = c.env.DB, userId = c.req.param("userId");
    await assertNotOwner(c, expectedWorkspaceId, userId);
    const result = await authorized(c, expectedWorkspaceId, WORKSPACE_ROLES.manage, [
      db.prepare("UPDATE members SET role=? WHERE workspace_id=? AND user_id=? AND role<>'owner' RETURNING role").bind(role, expectedWorkspaceId, userId),
      db.prepare(`DELETE FROM invites WHERE workspace_id=? AND invited_by=? AND accepted_at IS NULL AND ? NOT IN ('owner','editor')
        AND EXISTS(SELECT 1 FROM members WHERE workspace_id=? AND user_id=? AND role=?)`).bind(expectedWorkspaceId, userId, role, expectedWorkspaceId, userId, role),
    ]);
    if (result[1]!.meta.changes !== 1) throw new ApiError(404, "member_not_found", "멤버를 찾을 수 없어요.");
    return c.json({ userId, role });
  })
  .delete("/members/:userId", ownerOnly, async (c) => {
    const expectedWorkspaceId = parse(expected, c.req.query("expectedWorkspaceId")), db = c.env.DB, userId = c.req.param("userId"), at = now();
    await assertNotOwner(c, expectedWorkspaceId, userId);
    const result = await authorized(c, expectedWorkspaceId, WORKSPACE_ROLES.manage, [
      db.prepare(`DELETE FROM invites WHERE workspace_id=? AND invited_by=? AND accepted_at IS NULL
        AND EXISTS(SELECT 1 FROM members WHERE workspace_id=? AND user_id=? AND role<>'owner')`).bind(expectedWorkspaceId, userId, expectedWorkspaceId, userId),
      db.prepare("INSERT INTO events(id,workspace_id,name,props,at) SELECT ?,?,'member_removed',json_object('role',role),? FROM members WHERE workspace_id=? AND user_id=? AND role<>'owner'").bind(newId(), expectedWorkspaceId, at, expectedWorkspaceId, userId),
      db.prepare("DELETE FROM members WHERE workspace_id=? AND user_id=? AND role<>'owner'").bind(expectedWorkspaceId, userId),
    ]);
    if (result[3]!.meta.changes !== 1) throw new ApiError(404, "member_not_found", "멤버를 찾을 수 없어요.");
    return c.json({ ok: true });
  });

async function assertNotOwner(c: Context<AppEnv>, workspaceId: string, userId: string) {
  const actor = workspaceCtx(c);
  if (actor.workspace.id !== workspaceId) throw workspaceChanged();
  const row = await c.env.DB.prepare("SELECT role FROM members WHERE workspace_id=? AND user_id=?").bind(workspaceId, userId).first<{ role: Role }>();
  if (!row) throw new ApiError(404, "member_not_found", "멤버를 찾을 수 없어요.");
  if (row.role === "owner") throw new ApiError(400, "owner_locked", "소유자는 역할을 바꾸거나 제거할 수 없어요.");
}
function escapeHtml(text: string) { return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`); }
