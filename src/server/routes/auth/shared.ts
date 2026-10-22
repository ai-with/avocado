import type { Context } from "hono";
import { z } from "zod";
import { and, count, eq, gt, ne } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { authAttempts, users } from "../../db/schema";
import { ApiError } from "../../lib/errors";
import { newId, now } from "../../lib/ids";

// 인증 라우트 공용

export const email = z.string().trim().toLowerCase().pipe(z.email("이메일 형식이 아닙니다."));
export const password = z.string().min(8, "비밀번호는 8자 이상이어야 합니다.").max(200);

export const MIN = 60 * 1000;
export const LOGIN_WINDOW = 15 * MIN;

export const clientIp = (c: Context<AppEnv>) => c.req.header("cf-connecting-ip") ?? "local";

export async function attemptsSince(db: Db, key: string, windowMs: number) {
  const row = await db.select({ n: count() }).from(authAttempts).where(and(eq(authAttempts.key, key), gt(authAttempts.createdAt, now() - windowMs))).get();
  return row?.n ?? 0;
}
export const recordAttempt = (db: Db, key: string) => db.insert(authAttempts).values({ id: newId(), key, createdAt: now() });

export async function phoneOwnedByOther(db: Db, phone: string, userId: string) {
  return !!(await db.select({ id: users.id }).from(users).where(and(eq(users.phoneE164, phone), ne(users.id, userId))).get());
}
export const phoneInUse = () => new ApiError(409, "phone_in_use", "이미 다른 계정에 등록된 번호입니다. 한 번호로는 계정을 하나만 만들 수 있습니다.", { phone: "이미 다른 계정에 등록된 번호입니다." });
