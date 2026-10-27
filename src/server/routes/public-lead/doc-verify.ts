import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { docVerifyTokens, leads } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newToken, now, sha256Hex } from "../../lib/ids";
import { sendEmail } from "../../lib/email";
import { escapeHtml } from "../../lib/html";
import { logEvent } from "../../lib/events";
import { SERVICE_NAME } from "../../../shared/brand";
import { brandName } from "./shared";
import { docForSlug, passGate, viewFor, type Doc } from "./doc-access";

// 게이트 이메일 인증(requireVerify): 인증 메일, 다시 보내기, 링크 확인

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_INTERVAL_MS = 60_000;

const resendBody = z.object({ viewToken: z.string() });
const verifyBody = z.object({ token: z.string().min(1).max(200) });

// 1회용 토큰을 만들고 인증 링크를 메일로 보낸다. 원문 토큰은 메일에만 남긴다
export async function sendVerifyMail(c: Context<AppEnv>, doc: Doc, slug: string, view: { id: string; leadId: string }, email: string) {
  const raw = newToken(24);
  await c.var.db.insert(docVerifyTokens).values({ tokenHash: await sha256Hex(raw), documentId: doc.id, viewId: view.id, leadId: view.leadId, expiresAt: now() + VERIFY_TTL_MS, createdAt: now() });
  // 운영은 고정 주소(Host 헤더를 믿지 않는다), 로컬 개발은 요청한 주소로 돌아오게 한다
  const origin = c.env.APP_ENV === "production" ? c.env.APP_URL : new URL(c.req.url).origin;
  const url = `${origin}/d/${encodeURIComponent(slug)}?verify=${raw}`;
  const brand = (await brandName(c.var.db, doc.workspaceId)) || SERVICE_NAME;
  await sendEmail(c.env, {
    to: email,
    subject: `[${brand}] ${doc.title} 열람 인증`,
    text: `아래 링크를 누르면 "${doc.title}" 자료를 이어서 볼 수 있어요. 링크는 24시간 동안 한 번만 쓸 수 있어요.\n${url}`,
    html: `<p>아래 버튼을 누르면 "${escapeHtml(doc.title)}" 자료를 이어서 볼 수 있어요.</p><p><a href="${escapeHtml(url)}">인증하고 이어서 보기</a></p><p>링크는 24시간 동안 한 번만 쓸 수 있어요.</p>`,
  });
}

export const publicDocVerifyRoutes = new Hono<AppEnv>()
  // 인증 메일 다시 보내기. 같은 열람 세션은 1분에 한 번
  .post("/doc/:slug/gate/resend", async (c) => {
    const db = c.var.db;
    const slug = c.req.param("slug");
    const { doc } = await docForSlug(db, slug);
    const view = await viewFor(db, parse(resendBody, await c.req.json()).viewToken, doc.id);
    if (!view.leadId || !doc.gate.requireVerify) throw new ApiError(400, "verify_not_started", "이메일을 먼저 입력해 주세요.");
    const last = await db.select({ createdAt: docVerifyTokens.createdAt }).from(docVerifyTokens).where(eq(docVerifyTokens.viewId, view.id)).orderBy(desc(docVerifyTokens.createdAt)).get();
    if (last && now() - last.createdAt < RESEND_INTERVAL_MS) throw new ApiError(429, "too_many_requests", "1분 뒤에 다시 보낼 수 있어요.");
    const lead = await db.select({ email: leads.email }).from(leads).where(eq(leads.id, view.leadId)).get();
    if (!lead) throw new ApiError(400, "verify_not_started", "이메일을 먼저 입력해 주세요.");
    await sendVerifyMail(c, doc, slug, { id: view.id, leadId: view.leadId }, lead.email);
    return c.json({ ok: true });
  })
  // 메일 링크 확인. 맞으면 토큰을 쓴 것으로 표시하고 열람 토큰을 준다
  .post("/doc/:slug/verify", async (c) => {
    const db = c.var.db;
    const { link, doc } = await docForSlug(db, c.req.param("slug"));
    const hash = await sha256Hex(parse(verifyBody, await c.req.json()).token);
    const row = await db.select().from(docVerifyTokens).where(and(eq(docVerifyTokens.tokenHash, hash), eq(docVerifyTokens.documentId, doc.id))).get();
    if (!row || row.usedAt) throw new ApiError(410, "verify_invalid", "이미 썼거나 잘못된 인증 링크예요. 자료에서 메일을 다시 받아 주세요.");
    if (row.expiresAt < now()) throw new ApiError(410, "verify_expired", "인증 링크가 만료됐어요. 자료에서 메일을 다시 받아 주세요.");
    const claimed = await db.update(docVerifyTokens).set({ usedAt: now() }).where(and(eq(docVerifyTokens.tokenHash, hash), isNull(docVerifyTokens.usedAt))).returning({ h: docVerifyTokens.tokenHash });
    if (!claimed.length) throw new ApiError(410, "verify_invalid", "이미 썼거나 잘못된 인증 링크예요. 자료에서 메일을 다시 받아 주세요.");
    await logEvent(db, doc.workspaceId, "lead_verified", { link_id: link.id, channel: link.channelKey });
    return c.json({ unlockToken: await passGate(c, doc, row.leadId, link.guideId), viewToken: row.viewId });
  });
