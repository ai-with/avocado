import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { leads } from "../../db/schema";
import { ApiError } from "../../lib/errors";
import { now } from "../../lib/ids";
import { publicDocRoutes } from "./docs";
import { publicFormRoutes } from "./forms";

export { shortLinkRedirect } from "./redirect";
export { validateFormAnswers } from "./forms";

const ASSET_CACHE_S = 86400;

const miscRoutes = new Hono<AppEnv>()
  // 수신 거부. 발송 메일의 링크(TASK-021)가 이 경로를 쓴다
  .post("/unsubscribe/:token", async (c) => {
    const db = c.var.db;
    const lead = await db.select({ id: leads.id, unsubscribedAt: leads.unsubscribedAt }).from(leads).where(eq(leads.unsubscribeToken, c.req.param("token"))).get();
    if (!lead) throw new ApiError(404, "not_found", "수신 거부 링크를 찾을 수 없어요.");
    if (!lead.unsubscribedAt) await db.update(leads).set({ unsubscribedAt: now() }).where(eq(leads.id, lead.id));
    return c.json({ ok: true });
  })
  // 미리보기 카드·폼 헤더 이미지
  .get("/asset/:key{lead-assets/.+}", async (c) => {
    const obj = await c.env.FILES.get(c.req.param("key"));
    if (!obj) return c.notFound();
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": `public, max-age=${ASSET_CACHE_S}` } });
  });

// 리드 공개 API (/api/public): 자료 열람·게이트, 폼, 수신 거부, 이미지
export const publicLeadRoutes = new Hono<AppEnv>().route("/", publicDocRoutes).route("/", publicFormRoutes).route("/", miscRoutes);
