import { Hono } from "hono";
import { z } from "zod";
import { and, count, desc, eq, gt } from "drizzle-orm";
import type { AppEnv, Auth } from "../../types";
import type { Db } from "../../db";
import { phoneVerifications, users } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now, sha256Hex } from "../../lib/ids";
import { sendSms } from "../../lib/sms";
import { CODE_TTL_MS, MAX_ATTEMPTS, judgeCode, maskPhone, newCode, normalizePhone } from "../../lib/phone";
import { sessionCtx } from "../../middleware/auth";
import { MIN, clientIp, phoneInUse, phoneOwnedByOther } from "./shared";

// 휴대폰 인증 (가입 완료, 번호 변경 공통). 인증 전 세션에서도 쓴다

const DAY_MS = 24 * 60 * MIN;
const SENDS_PER_DAY = 5;
const SENDS_PER_MINUTE = 3;
const RESEND_AFTER_S = 60;
const phoneSchema = z.object({ phone: z.string().trim().min(1, "휴대폰 번호를 입력해 주세요.") });
const verifySchema = z.object({ phone: z.string().trim().min(1), code: z.string().trim().regex(/^\d{6}$/, "인증번호 6자리를 입력해 주세요.") });
type Verification = typeof phoneVerifications.$inferSelect;

// 번호당 하루 5번, IP 당 1분 3번
async function checkSendLimits(db: Db, phone: string, ip: string) {
  const day = await db.select({ n: count() }).from(phoneVerifications).where(and(eq(phoneVerifications.phoneE164, phone), gt(phoneVerifications.createdAt, now() - DAY_MS))).get();
  if ((day?.n ?? 0) >= SENDS_PER_DAY) throw new ApiError(429, "too_many_requests", "이 번호로는 오늘 인증번호를 더 보낼 수 없어요. 내일 다시 시도해 주세요.");
  const minute = await db.select({ n: count() }).from(phoneVerifications).where(and(eq(phoneVerifications.ip, ip), gt(phoneVerifications.createdAt, now() - MIN))).get();
  if ((minute?.n ?? 0) >= SENDS_PER_MINUTE) throw new ApiError(429, "too_many_requests", "요청이 너무 잦아요. 1분 뒤에 다시 시도해 주세요.");
}

async function judgeOrThrow(db: Db, row: Verification, code: string) {
  const verdict = judgeCode(row, await sha256Hex(`${row.id}:${code}`), now());
  if (verdict === "used") throw new ApiError(400, "code_used", "이미 사용한 인증번호예요. 새로 받아 주세요.");
  if (verdict === "too_many") throw new ApiError(429, "too_many_attempts", "입력 횟수를 넘었어요. 인증번호를 새로 받아 주세요.");
  if (verdict === "expired") throw new ApiError(400, "code_expired", "인증번호가 만료되었어요. 새로 받아 주세요.");
  if (verdict !== "mismatch") return;
  await db.update(phoneVerifications).set({ attempts: row.attempts + 1 }).where(eq(phoneVerifications.id, row.id));
  const left = MAX_ATTEMPTS - row.attempts - 1;
  throw new ApiError(400, "code_mismatch", left > 0 ? `인증번호가 맞지 않아요. ${left}번 더 입력할 수 있어요.` : "인증번호가 맞지 않아요. 새로 받아 주세요.", { code: "인증번호가 맞지 않아요." });
}

async function savePhone(db: Db, auth: Auth, phone: string, verificationId: string) {
  if (await phoneOwnedByOther(db, phone, auth.user.id)) throw phoneInUse();
  try {
    await db.batch([
      db.update(users).set({ phoneE164: phone, phoneVerifiedAt: now() }).where(eq(users.id, auth.user.id)),
      db.update(phoneVerifications).set({ verifiedAt: now() }).where(eq(phoneVerifications.id, verificationId)),
    ]);
  } catch (e) {
    // 동시에 같은 번호를 인증한 경우 unique 제약이 막는다
    if (String(e).includes("UNIQUE")) throw phoneInUse();
    throw e;
  }
}

export const phoneRoutes = new Hono<AppEnv>()
  .post("/phone/send", async (c) => {
    const auth = sessionCtx(c);
    const db = c.var.db;
    const phone = normalizePhone(parse(phoneSchema, await c.req.json()).phone);
    if (!phone) throw new ApiError(400, "validation_error", "휴대폰 번호 형식이 아니에요.", { phone: "010으로 시작하는 휴대폰 번호를 입력해 주세요." });
    if (phone === auth.phone && auth.phoneVerified) throw new ApiError(400, "phone_same", "지금 등록된 번호와 같아요.", { phone: "지금 등록된 번호와 같아요." });
    if (await phoneOwnedByOther(db, phone, auth.user.id)) throw phoneInUse();
    const ip = clientIp(c);
    await checkSendLimits(db, phone, ip);

    const id = newId();
    const code = newCode();
    await db.insert(phoneVerifications).values({ id, userId: auth.user.id, phoneE164: phone, codeHash: await sha256Hex(`${id}:${code}`), purpose: auth.phoneVerified ? "change" : "signup", expiresAt: now() + CODE_TTL_MS, ip, createdAt: now() });
    const sms = await sendSms(c.env, phone, `[워크스페이스 서비스] 인증번호 ${code} (5분 안에 입력)`);
    if (!sms.delivered && sms.reason === "provider_error") throw new ApiError(502, "sms_failed", "문자를 보내지 못했어요. 잠시 후 다시 시도해 주세요.");
    const devCode = !sms.delivered && c.env.APP_ENV !== "production" ? code : undefined;
    return c.json({ phone: maskPhone(phone), expiresAt: now() + CODE_TTL_MS, resendAfterSec: RESEND_AFTER_S, devCode });
  })
  .post("/phone/verify", async (c) => {
    const auth = sessionCtx(c);
    const db = c.var.db;
    const body = parse(verifySchema, await c.req.json());
    const phone = normalizePhone(body.phone);
    const row = phone
      ? await db.select().from(phoneVerifications).where(and(eq(phoneVerifications.userId, auth.user.id), eq(phoneVerifications.phoneE164, phone))).orderBy(desc(phoneVerifications.createdAt)).get()
      : undefined;
    if (!phone || !row) throw new ApiError(400, "code_not_sent", "인증번호를 먼저 받아 주세요.");
    await judgeOrThrow(db, row, body.code);
    await savePhone(db, auth, phone, row.id);
    return c.json({ phone: maskPhone(phone), phoneVerified: true });
  });
