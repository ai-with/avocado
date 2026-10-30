import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { members } from "../../db/schema";
import { newToken } from "../../lib/ids";
import { escapeHtml } from "../../lib/html";

// 리드 공개 경로(/l, /d, /form) 공용

const VISITOR_COOKIE = "lv";
const YEAR_S = 365 * 24 * 60 * 60;
export const NOINDEX = { "X-Robots-Tag": "noindex, nofollow" };

// 방문자 쿠키. 고유 클릭 추정과 재열람 계산에 쓴다
export function visitorId(c: Context<AppEnv>): string {
  const existing = getCookie(c, VISITOR_COOKIE);
  if (existing && /^[\w-]{8,64}$/.test(existing)) return existing;
  const id = newToken(12);
  setCookie(c, VISITOR_COOKIE, id, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: YEAR_S });
  return id;
}

// 로그인한 워크스페이스 구성원의 클릭·열람은 집계에서 뺀다('내 조회 제외')
export async function isMember(c: Context<AppEnv>, workspaceId: string): Promise<boolean> {
  const auth = c.var.auth;
  if (!auth) return false;
  const m = await c.var.db.select({ role: members.role }).from(members).where(and(eq(members.workspaceId, workspaceId), eq(members.userId, auth.user.id))).get();
  return !!m;
}


export function htmlPage(title: string, body: string, head = "") {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>${head}<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px;color:#1e1d1c;background:#fefdfb;text-align:center}p{color:#5f5b55}</style></head><body><div>${body}</div></body></html>`;
}

export const consentFields = {
  privacyAgreed: z.literal(true, { error: "개인정보 수집·이용에 동의해야 제출할 수 있어요." }),
  marketingOptIn: z.boolean().default(false),
  alimtalkOptIn: z.boolean().default(false),
};
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("이메일 형식이 아니에요."));
// 게이트·폼 공통 연락처 입력
export const contactFields = {
  email: emailSchema,
  name: z.string().trim().max(100).optional(),
  company: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(30).optional(),
};
