import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { members, sessions, users, workspaces } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { hashPassword, verifyPassword } from "../../lib/password";
import { newId, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { defaultBrandInsert } from "../../lib/brands";
import { actorParams, assertSql, ensureSessionScope, sessionPredicate, writeUnavailable } from "../../lib/workspace-access";
import { maskPhone } from "../../lib/phone";
import { createSession, destroySession, sessionCtx } from "../../middleware/auth";
import { acceptInvite, checkInvite } from "../invites";
import { listWorkspaces } from "../workspaces";
import { LOGIN_WINDOW, attemptsSince, email, password, recordAttempt } from "./shared";

// 이메일 가입·로그인·로그아웃·내 정보, 구글 가입자의 첫 워크스페이스

const LOGIN_MAX = 10;
const signupSchema = z
  .object({
    name: z.string().trim().min(1, "이름을 입력해 주세요.").max(50),
    email,
    password,
    workspaceName: z.string().trim().max(60).optional(),
    inviteToken: z.string().optional(),
  })
  .refine((v) => v.inviteToken || v.workspaceName, { path: ["workspaceName"], message: "워크스페이스 이름을 입력해 주세요." });
const loginSchema = z.object({ email, password: z.string().min(1, "비밀번호를 입력해 주세요.") });
type User = { id: string; email: string; name: string };

// 초대로 가입하면 초대한 워크스페이스에, 아니면 새 워크스페이스의 owner 로 들어간다
async function createAccount(db: Db, body: z.infer<typeof signupSchema>, user: User) {
  const userInsert = db.insert(users).values({ ...user, passwordHash: await hashPassword(body.password), createdAt: now() });
  if (body.inviteToken) {
    await userInsert;
    return acceptInvite(db, body.inviteToken, user);
  }
  const workspaceId = newId();
  await db.batch([
    userInsert,
    db.insert(workspaces).values({ id: workspaceId, name: body.workspaceName!, createdAt: now() }),
    defaultBrandInsert(db, workspaceId, body.workspaceName!),
    db.insert(members).values({ workspaceId, userId: user.id, role: "owner", createdAt: now() }),
  ]);
  await logEvent(db, workspaceId, "workspace_created", {});
  return workspaceId;
}

export const accountRoutes = new Hono<AppEnv>()
  .post("/signup", async (c) => {
    const body = parse(signupSchema, await c.req.json());
    const db = c.var.db;
    const exists = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).get();
    if (exists) throw new ApiError(409, "email_taken", "이미 가입된 이메일이에요.", { email: "이미 가입된 이메일이에요." });
    if (body.inviteToken) await checkInvite(db, body.inviteToken, body.email);
    const user = { id: newId(), email: body.email, name: body.name };
    const workspaceId = await createAccount(db, body, user);
    // 휴대폰 인증 전까지는 requireAuthCtx 가 403 phone_required 로 막는다
    await createSession(c, user.id, workspaceId);
    return c.json({ user, phoneVerified: false }, 201);
  })
  .post("/login", async (c) => {
    const body = parse(loginSchema, await c.req.json());
    const db = c.var.db;
    const key = `login:${body.email}`;
    if ((await attemptsSince(db, key, LOGIN_WINDOW)) >= LOGIN_MAX) {
      throw new ApiError(429, "too_many_attempts", "로그인 시도가 너무 많아요. 15분 뒤에 다시 시도해 주세요.");
    }
    const row = await db.select().from(users).where(eq(users.email, body.email)).get();
    if (!row || !(await verifyPassword(body.password, row.passwordHash))) {
      await recordAttempt(db, key);
      throw new ApiError(401, "invalid_credentials", "이메일 또는 비밀번호가 맞지 않아요.");
    }
    await createSession(c, row.id, null);
    return c.json({ user: { id: row.id, email: row.email, name: row.name }, phoneVerified: row.phoneVerifiedAt !== null });
  })
  .post("/logout", async (c) => {
    await destroySession(c);
    return c.json({ ok: true });
  })
  // 로그아웃 상태는 오류가 아니므로 401 대신 null (공개 페이지마다 콘솔 오류가 찍히지 않게)
  .get("/me", async (c) => {
    c.header("Cache-Control", "no-store");
    if (!c.var.auth) return c.json(null);
    const auth = sessionCtx(c);
    return c.json({
      user: { ...auth.user, phone: auth.phone ? maskPhone(auth.phone) : null },
      phoneVerified: auth.phoneVerified,
      workspace: auth.workspace,
      role: auth.role,
      workspaces: await listWorkspaces(c.var.db, auth.user.id),
    });
  })
  // 구글로 가입해 워크스페이스가 없는 사용자의 첫 워크스페이스. 휴대폰 인증 뒤에만
  .post("/onboarding", async (c) => {
    const auth = sessionCtx(c);
    if (!auth.phoneVerified) throw new ApiError(403, "phone_required", "휴대폰 번호 인증을 먼저 마쳐 주세요.");
    const { workspaceName, expectedUserId } = parse(z.object({ workspaceName: z.string().trim().min(1, "워크스페이스 이름을 입력해 주세요.").max(60), expectedUserId: z.string().min(1).max(100).optional() }), await c.req.json());
    if (expectedUserId && expectedUserId !== auth.user.id) throw new ApiError(409, "session_changed", "로그인한 계정이 바뀌었어요. 화면을 새로 확인해 주세요.");
    const db = c.var.db;
    if (auth.workspace) throw new ApiError(409, "has_workspace", "이미 워크스페이스가 있어요.");
    const workspaceId = newId(), at = now(), d1 = db.$client;
    try {
      await d1.batch([
        assertSql(d1, `${sessionPredicate} AND NOT EXISTS(SELECT 1 FROM members WHERE user_id=?)`, [...actorParams(auth, null, at), auth.user.id]),
        d1.prepare("INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)").bind(workspaceId, workspaceName, at),
        d1.prepare("INSERT INTO brands(id,workspace_id,name,created_at) VALUES(?,?,?,?)").bind(newId(), workspaceId, workspaceName, at),
        d1.prepare("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES(?,?,'owner',?)").bind(workspaceId, auth.user.id, at),
        d1.prepare("UPDATE sessions SET current_workspace_id=? WHERE id=? AND user_id=?").bind(workspaceId, auth.sessionId, auth.user.id),
        d1.prepare("INSERT INTO events(id,workspace_id,name,props,at) VALUES(?,?,'workspace_created','{}',?)").bind(newId(), workspaceId, at),
      ]);
    } catch {
      const membership = await d1.prepare("SELECT user_id FROM members WHERE user_id=? LIMIT 1").bind(auth.user.id).first();
      if (membership) throw new ApiError(409, "has_workspace", "이미 워크스페이스가 있어요.");
      await ensureSessionScope(d1, auth, null, now());
      console.error("[first_workspace_failed]", JSON.stringify({ failures: 1 }));
      throw writeUnavailable();
    }
    return c.json({ workspaceId }, 201);
  });
