import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { PublicUnsubscribe } from "../../../shared/unsubscribe";
import { leads, workspaces } from "../../db/schema";
import { ApiError } from "../../lib/errors";
import { now } from "../../lib/ids";
import { publicDocRoutes } from "./docs";
import { publicDocVerifyRoutes } from "./doc-verify";
import { publicFormRoutes } from "./forms";

export { shortLinkRedirect } from "./redirect";
export { validateFormAnswers } from "./forms";

const ASSET_CACHE_S = 86400;

const miscRoutes = new Hono<AppEnv>()
  .use("/unsubscribe/:token", async (c, next) => { c.header("Cache-Control", "no-store"); await next(); })
  // Reading the mailed capability identifies its brand without unsubscribing.
  .get("/unsubscribe/:token", async (c) => {
    const metadata = await c.var.db.select({ workspaceName: workspaces.name }).from(leads)
      .innerJoin(workspaces, eq(workspaces.id, leads.workspaceId))
      .where(eq(leads.unsubscribeToken, c.req.param("token"))).get();
    if (!metadata) throw new ApiError(404, "not_found", "수신 거부 링크를 찾을 수 없어요.");
    return c.json(metadata satisfies PublicUnsubscribe);
  })
  // 수신 거부. 발송 메일의 링크(TASK-021)가 이 경로를 쓴다
  .post("/unsubscribe/:token", async (c) => {
    const db = c.var.db;
    const lead = await db.select({ id: leads.id, unsubscribedAt: leads.unsubscribedAt }).from(leads).where(eq(leads.unsubscribeToken, c.req.param("token"))).get();
    if (!lead) throw new ApiError(404, "not_found", "수신 거부 링크를 찾을 수 없어요.");
    if (lead.unsubscribedAt === null) await db.update(leads).set({ unsubscribedAt: now() })
      .where(and(eq(leads.id, lead.id), isNull(leads.unsubscribedAt)));
    return c.json({ ok: true });
  })
  // 미리보기 카드·폼 헤더 이미지
  .get("/asset/:key{lead-assets/.+}", async (c) => {
    const obj = await c.env.FILES.get(c.req.param("key"));
    if (!obj) return c.notFound();
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": `public, max-age=${ASSET_CACHE_S}` } });
  });

// 리드 공개 API (/api/public): 자료 열람·게이트·인증, 폼, 수신 거부, 이미지
export const publicLeadRoutes = new Hono<AppEnv>().route("/", publicDocRoutes).route("/", publicDocVerifyRoutes).route("/", publicFormRoutes).route("/", miscRoutes);
