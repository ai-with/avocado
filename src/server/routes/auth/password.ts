import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { authAttempts, passwordResets, sessions, users } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { hashPassword } from "../../lib/password";
import { newToken, now, sha256Hex } from "../../lib/ids";
import { sendEmail } from "../../lib/email";
import { LOGIN_WINDOW, MIN, attemptsSince, email, password, recordAttempt } from "./shared";

// 비밀번호 재설정

const RESET_TTL = 30 * MIN;
const FORGOT_MAX = 3;

export const passwordRoutes = new Hono<AppEnv>()
  // 가입 여부를 드러내지 않으려고 항상 ok
  .post("/password/forgot", async (c) => {
    const { email: addr } = parse(z.object({ email }), await c.req.json());
    const db = c.var.db;
    const key = `forgot:${addr}`;
    const user = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, addr)).get();
    if (!user || (await attemptsSince(db, key, LOGIN_WINDOW)) >= FORGOT_MAX) return c.json({ ok: true });
    await recordAttempt(db, key);
    const token = newToken(32);
    await db.insert(passwordResets).values({ id: await sha256Hex(token), userId: user.id, expiresAt: now() + RESET_TTL, createdAt: now() });
    const url = `${c.env.APP_URL}/reset-password/${token}`;
    await sendEmail(c.env, {
      to: addr,
      subject: "비밀번호 재설정 안내",
      text: `${user.name} 님, 아래 링크에서 새 비밀번호를 정해 주세요. 링크는 30분 동안 쓸 수 있어요.\n${url}`,
      html: `<p>${user.name.replace(/</g, "&lt;")} 님, 아래 링크에서 새 비밀번호를 정해 주세요. 링크는 30분 동안 쓸 수 있어요.</p><p><a href="${url}">비밀번호 재설정</a></p>`,
    });
    return c.json({ ok: true });
  })
  .post("/password/reset", async (c) => {
    const body = parse(z.object({ token: z.string().min(1), password }), await c.req.json());
    const db = c.var.db;
    const id = await sha256Hex(body.token);
    const row = await db.select().from(passwordResets).where(eq(passwordResets.id, id)).get();
    if (!row || row.usedAt || row.expiresAt < now()) {
      throw new ApiError(410, "reset_invalid", "만료되었거나 이미 사용한 링크예요. 비밀번호 찾기를 다시 해 주세요.");
    }
    const user = await db.select({ email: users.email }).from(users).where(eq(users.id, row.userId)).get();
    await db.batch([
      db.update(users).set({ passwordHash: await hashPassword(body.password) }).where(eq(users.id, row.userId)),
      db.update(passwordResets).set({ usedAt: now() }).where(eq(passwordResets.id, id)),
      // 다른 기기 세션은 모두 끊는다
      db.delete(sessions).where(eq(sessions.userId, row.userId)),
      // 로그인 실패로 잠긴 사람이 재설정 직후 바로 들어올 수 있게 한다
      db.delete(authAttempts).where(eq(authAttempts.key, `login:${user?.email}`)),
    ]);
    return c.json({ ok: true });
  });
