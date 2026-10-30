import { Hono } from "hono";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { brands, campaigns, guideInfluencers, guides, influencers } from "../../db/schema";
import { parse } from "../../lib/errors";
import { findOwned } from "../../lib/owned";
import { contractOf, roundsFor } from "../../lib/participation";
import { newId, now } from "../../lib/ids";
import { workspaceCtx, editorsOnly } from "../../middleware/auth";
import type { Db } from "../../db";
import { influencerBody, influencerValues } from "./schemas";

// 인플루언서 (워크스페이스 단위 재사용)

// 인플루언서 상세: 브랜드·캠페인별 참여(회차, 상태, 조건, 기간). 이력은 캠페인을 펼칠 때 따로 부른다 (TASK-072)
async function participationsOf(db: Db, workspaceId: string, influencerId: string) {
  const rows = await db
    .select({ gi: guideInfluencers, guideId: guides.id, campaignName: campaigns.name, brandId: brands.id, brandName: brands.name })
    .from(guideInfluencers)
    .innerJoin(guides, eq(guides.id, guideInfluencers.guideId))
    .innerJoin(campaigns, eq(campaigns.id, guides.campaignId))
    .innerJoin(brands, eq(brands.id, campaigns.brandId))
    .where(and(eq(guideInfluencers.influencerId, influencerId), eq(guides.workspaceId, workspaceId)))
    .orderBy(asc(guideInfluencers.createdAt));
  const rounds = await roundsFor(db, workspaceId, [influencerId]);
  return rows.map((r) => ({
    id: r.gi.id,
    guideId: r.guideId,
    campaignName: r.campaignName,
    brandId: r.brandId,
    brandName: r.brandName,
    status: r.gi.status,
    terms: r.gi.terms,
    round: rounds.get(r.gi.id) ?? 1,
    createdAt: r.gi.createdAt,
    ...contractOf(r.gi),
  }));
}

export const influencerRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const list = await c.var.db
      .select({
        id: influencers.id,
        displayName: influencers.displayName,
        igHandle: influencers.igHandle,
        threadsHandle: influencers.threadsHandle,
        email: influencers.email,
        lang: influencers.lang,
        country: influencers.country,
        createdAt: influencers.createdAt,
        guideCount: sql<number>`(SELECT count(*) FROM guide_influencers gi WHERE gi.influencer_id = influencers.id)`,
      })
      .from(influencers)
      .where(eq(influencers.workspaceId, workspace.id))
      .orderBy(desc(influencers.createdAt));
    return c.json({ influencers: list });
  })
  .get("/:id", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const influencer = await findOwned(db, influencers, c.req.param("id"), workspace.id, { code: "influencer_not_found", message: "인플루언서를 찾을 수 없어요." });
    return c.json({ influencer, participations: await participationsOf(db, workspace.id, influencer.id) });
  })
  .post("/", editorsOnly, async (c) => {
    const body = parse(influencerBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const id = newId();
    await c.var.db.insert(influencers).values({ id, workspaceId: workspace.id, ...influencerValues(body), createdAt: now() });
    return c.json({ id }, 201);
  })
  .patch("/:id", editorsOnly, async (c) => {
    const body = parse(influencerBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    await c.var.db
      .update(influencers)
      .set(influencerValues(body))
      .where(and(eq(influencers.id, c.req.param("id")), eq(influencers.workspaceId, workspace.id)));
    return c.json({ ok: true });
  })
  .delete("/:id", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    await c.var.db.delete(influencers).where(and(eq(influencers.id, c.req.param("id")), eq(influencers.workspaceId, workspace.id)));
    return c.json({ ok: true });
  });
