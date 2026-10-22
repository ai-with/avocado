import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { influencers } from "../../db/schema";
import { parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { workspaceCtx, editorsOnly } from "../../middleware/auth";
import { influencerBody, influencerValues } from "./schemas";

// 인플루언서 (워크스페이스 단위 재사용)

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
