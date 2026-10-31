import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { brands, campaigns, guidelineSets, guides } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { now } from "../../lib/ids";
import { findOwned } from "../../lib/owned";
import { findBrand } from "../../lib/brands";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { createCampaignGuide } from "../guides/guides";
import { GUIDE_DEFAULTS } from "../guides/schemas";

export { brandRoutes } from "./brands";
export { brandTermRoutes, reviewPresetRoutes } from "./brand-terms";

// 캠페인 (/api/campaigns). 캠페인 id = 브랜드 가이드 id 라 상세·탭은 /api/guides/:id 를 그대로 쓴다 (TASK-070)

const campaignName = z.string().trim().min(1, "캠페인 이름을 입력해 주세요.").max(80);
const createBody = z.object({ brandId: z.string().min(1, "브랜드를 골라 주세요."), name: campaignName });
const patchBody = z.object({ brandId: z.string().min(1), name: campaignName, status: z.enum(["active", "archived"]), endsAt: z.number().int().nonnegative().max(8_640_000_000_000_000 - 7 * 86_400_000).nullable() }).partial();
const notFound = { code: "campaign_not_found", message: "캠페인을 찾을 수 없어요." };

export const campaignRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const brandId = c.req.query("brandId");
    const list = await c.var.db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        status: campaigns.status,
        brandId: campaigns.brandId,
        brandName: brands.name,
        guideStatus: guides.status,
        createdAt: campaigns.createdAt,
        endsAt: campaigns.endsAt,
        archivedAt: campaigns.archivedAt,
        influencerCount: sql<number>`(SELECT count(*) FROM guide_influencers gi WHERE gi.guide_id = ${guides.id})`,
      })
      .from(campaigns)
      .innerJoin(brands, eq(brands.id, campaigns.brandId))
      .innerJoin(guides, eq(guides.campaignId, campaigns.id))
      .where(and(eq(campaigns.workspaceId, workspace.id), brandId ? eq(campaigns.brandId, brandId) : undefined))
      .orderBy(desc(campaigns.createdAt));
    return c.json({ campaigns: list });
  })
  // 브랜드 고르기 + 이름 → 캠페인과 빈 브랜드 가이드를 함께 만든다. 규정 세트는 첫 세트를 미리 고른다
  .post("/", editorsOnly, async (c) => {
    const { brandId, name } = parse(createBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const brand = await findBrand(db, workspace.id, brandId);
    const firstSet = await db.select({ id: guidelineSets.id }).from(guidelineSets).where(eq(guidelineSets.workspaceId, workspace.id)).orderBy(asc(guidelineSets.createdAt)).get();
    const id = await createCampaignGuide(db, workspace.id, brand.id, { ...GUIDE_DEFAULTS, name, guidelineSetId: firstSet?.id ?? null });
    return c.json({ id }, 201);
  })
  .patch("/:id", editorsOnly, async (c) => {
    const body = parse(patchBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const campaign = await findOwned(db, campaigns, c.req.param("id"), workspace.id, notFound);
    if (body.brandId) await findBrand(db, workspace.id, body.brandId);
    const status = body.status ?? campaign.status;
    const endsAt = body.endsAt === undefined ? campaign.endsAt : body.endsAt;
    if (status === "archived" && endsAt === null && (campaign.status !== "archived" || body.endsAt !== undefined))
      throw new ApiError(400, "campaign_end_required", "캠페인을 보관하려면 실제 종료 시각을 먼저 입력해 주세요.");
    const archivedAt = status === "archived" && campaign.status !== "archived" ? now() : campaign.archivedAt;
    const changed = await db.update(campaigns).set({ ...body, archivedAt, updatedAt: Math.max(now(), campaign.updatedAt + 1) })
      .where(and(eq(campaigns.id, campaign.id), eq(campaigns.updatedAt, campaign.updatedAt))).returning({ id: campaigns.id });
    if (!changed.length) throw new ApiError(409, "campaign_changed", "캠페인이 바뀌었어요. 새로고침한 뒤 다시 저장해 주세요.");
    return c.json({ ok: true });
  });
