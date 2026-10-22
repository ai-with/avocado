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
    if (exists) throw new ApiError(409, "email_taken", "이미 가입된 이메일입니다.", { email: "이미 가입된 이메일입니다." });
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
      throw new ApiError(429, "too_many_attempts", "로그인 시도가 너무 많습니다. 15분 뒤에 다시 시도해 주세요.");
    }
    const row = await db.select().from(users).where(eq(users.email, body.email)).get();
    if (!row || !(await verifyPassword(body.password, row.passwordHash))) {
      await recordAttempt(db, key);
      throw new ApiError(401, "invalid_credentials", "이메일 또는 비밀번호가 맞지 않습니다.");
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
    const { workspaceName } = parse(z.object({ workspaceName: z.string().trim().min(1, "워크스페이스 이름을 입력해 주세요.").max(60) }), await c.req.json());
    const db = c.var.db;
    if (auth.workspace) throw new ApiError(409, "has_workspace", "이미 워크스페이스가 있습니다.");
    const workspaceId = newId();
    await db.batch([
      db.insert(workspaces).values({ id: workspaceId, name: workspaceName, createdAt: now() }),
      db.insert(members).values({ workspaceId, userId: auth.user.id, role: "owner", createdAt: now() }),
      db.update(sessions).set({ currentWorkspaceId: workspaceId }).where(eq(sessions.id, auth.sessionId)),
    ]);
    await logEvent(db, workspaceId, "workspace_created", {});
    return c.json({ workspaceId }, 201);
  });
