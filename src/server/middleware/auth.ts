import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { and, eq, asc, gt, isNull, sql } from "drizzle-orm";
import type { AppEnv, Auth, AuthWorkspace } from "../types";
import type { Role } from "../../shared/roles";
import { members, sessions, users, workspaces } from "../db/schema";
import { ApiError } from "../lib/errors";
import { newToken, now, sha256Hex } from "../lib/ids";

const COOKIE = "sid";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(c: Context<AppEnv>, userId: string, workspaceId: string | null) {
  const token = newToken(32);
  await c.var.db.insert(sessions).values({
    id: await sha256Hex(token),
    userId,
    currentWorkspaceId: workspaceId,
    expiresAt: now() + SESSION_MS,
    createdAt: now(),
  });
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: SESSION_MS / 1000 });
}

export async function destroySession(c: Context<AppEnv>) {
  const auth = c.var.auth;
  if (auth) await c.var.db.delete(sessions).where(eq(sessions.id, auth.sessionId));
  deleteCookie(c, COOKIE, { path: "/", secure: true });
}

export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  c.set("auth", null);
  const token = getCookie(c, COOKIE);
  if (token) c.set("auth", await resolveSession(c, token));
  await next();
});

async function resolveSession(c: Context<AppEnv>, token: string, attempt = 0): Promise<Auth | null> {
  const db = c.var.db;
  const id = await sha256Hex(token);
  const row = await db
    .select({ session: sessions, user: { id: users.id, email: users.email, name: users.name }, phone: users.phoneE164, phoneVerifiedAt: users.phoneVerifiedAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get();
  if (!row || row.session.expiresAt <= now()) return null;

  const memberships = await db
    .select({ workspace: { id: workspaces.id, name: workspaces.name, plan: workspaces.plan, onboardedAt: workspaces.onboardedAt, onboardingSkippedAt: members.onboardingSkippedAt }, role: members.role })
    .from(members)
    .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(eq(members.userId, row.user.id))
    .orderBy(asc(members.createdAt), asc(workspaces.id));
  let current = memberships.find((m) => m.workspace.id === row.session.currentWorkspaceId) ?? memberships[0];
  const selectedWorkspaceId = current?.workspace.id ?? null;
  if (selectedWorkspaceId !== row.session.currentWorkspaceId) {
    const membershipFence = current
      ? sql`EXISTS(SELECT 1 FROM members m JOIN workspaces w ON w.id=m.workspace_id
          WHERE m.workspace_id=${current.workspace.id} AND m.user_id=${row.user.id} AND m.role=${current.role})`
      : sql`NOT EXISTS(SELECT 1 FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=${row.user.id})`;
    const selected = await db.update(sessions).set({ currentWorkspaceId: selectedWorkspaceId }).where(and(
      eq(sessions.id, id), eq(sessions.userId, row.user.id), gt(sessions.expiresAt, now()),
      row.session.currentWorkspaceId === null ? isNull(sessions.currentWorkspaceId) : eq(sessions.currentWorkspaceId, row.session.currentWorkspaceId),
      membershipFence,
    )).returning({ id: sessions.id }).get();
    if (!selected) {
      // A switch/new workspace or membership change won after our read. Do not
      // persist a stale fallback or return Auth for the workspace we lost.
      if (attempt >= 3) throw new ApiError(409, "workspace_changed", "워크스페이스 선택이 바뀌었어요. 다시 확인해 주세요.");
      return resolveSession(c, token, attempt + 1);
    }
  }
  return {
    sessionId: id,
    user: row.user,
    workspace: current?.workspace ?? null,
    role: current?.role ?? null,
    phone: row.phone,
    phoneVerified: row.phoneVerifiedAt !== null,
  };
}

export async function setCurrentWorkspace(c: Context<AppEnv>, workspaceId: string) {
  const auth = requireAuthCtx(c);
  const m = await c.var.db
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, auth.user.id)))
    .get();
  if (!m) throw new ApiError(404, "workspace_not_found", "워크스페이스를 찾을 수 없어요.");
  await c.var.db.update(sessions).set({ currentWorkspaceId: workspaceId }).where(eq(sessions.id, auth.sessionId));
}

// 휴대폰 인증 전에도 허용되는 곳(me, 로그아웃, 휴대폰 인증, 첫 워크스페이스)에서만 쓴다
export function sessionCtx(c: Context<AppEnv>): Auth {
  const auth = c.var.auth;
  if (!auth) throw new ApiError(401, "unauthorized", "로그인이 필요해요.");
  return auth;
}

// 로그인 + 휴대폰 인증 완료. 모든 앱 API 는 이것(또는 workspaceCtx, requireAuth)을 거친다
export function requireAuthCtx(c: Context<AppEnv>): Auth {
  const auth = sessionCtx(c);
  if (!auth.phoneVerified) throw new ApiError(403, "phone_required", "휴대폰 번호 인증을 먼저 마쳐 주세요.");
  return auth;
}

// 현재 워크스페이스가 있는 로그인 상태를 보장하고 반환한다. 라우트 핸들러에서 쓴다
export function workspaceCtx(c: Context<AppEnv>): Auth & { workspace: AuthWorkspace; role: Role } {
  const auth = requireAuthCtx(c);
  if (!auth.workspace || !auth.role) throw new ApiError(403, "no_workspace", "속한 워크스페이스가 없어요.");
  return { ...auth, workspace: auth.workspace, role: auth.role };
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  requireAuthCtx(c);
  await next();
});

export const requireRole = (roles: Role[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const { role } = workspaceCtx(c);
    if (!roles.includes(role)) throw new ApiError(403, "forbidden", "이 작업을 할 권한이 없어요.");
    await next();
  });

// 콘텐츠를 만들고 고치는 쪽, 최종 승인하는 쪽
export const editorsOnly = requireRole(["owner", "editor"]);
export const approversOnly = requireRole(["owner", "approver"]);
