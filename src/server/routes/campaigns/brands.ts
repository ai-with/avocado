import { Hono } from "hono";
import { z } from "zod";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { brands, campaigns } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { brandDeleteBlock, findBrand } from "../../lib/brands";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";

// 설정 > 브랜드 (/api/brands). 워크스페이스 안에 브랜드 여럿 (TASK-070)

const brandBody = z.object({ name: z.string().trim().min(1, "브랜드 이름을 입력해 주세요.").max(60) });

export const brandRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const list = await c.var.db
      .select({
        id: brands.id,
        name: brands.name,
        createdAt: brands.createdAt,
        campaignCount: sql<number>`(SELECT count(*) FROM campaigns c WHERE c.brand_id = brands.id)`,
      })
      .from(brands)
      .where(and(eq(brands.workspaceId, workspace.id), isNull(brands.deletedAt)))
      .orderBy(asc(brands.createdAt));
    return c.json({ brands: list });
  })
  .post("/", editorsOnly, async (c) => {
    const { name } = parse(brandBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const id = newId();
    await c.var.db.insert(brands).values({ id, workspaceId: workspace.id, name, createdAt: now() });
    return c.json({ id }, 201);
  })
  .patch("/:id", editorsOnly, async (c) => {
    const { name } = parse(brandBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const b = await findBrand(c.var.db, workspace.id, c.req.param("id"));
    await c.var.db.update(brands).set({ name }).where(eq(brands.id, b.id));
    return c.json({ ok: true });
  })
  // 캠페인이 있거나 마지막 브랜드면 막는다. 지우면 deleted_at 만 남긴다
  .delete("/:id", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const b = await findBrand(db, workspace.id, c.req.param("id"));
    const [used, live] = await Promise.all([
      db.select({ n: count() }).from(campaigns).where(eq(campaigns.brandId, b.id)).get(),
      db.select({ n: count() }).from(brands).where(and(eq(brands.workspaceId, workspace.id), isNull(brands.deletedAt))).get(),
    ]);
    const block = brandDeleteBlock(used?.n ?? 0, live?.n ?? 0);
    if (block) throw new ApiError(409, "brand_in_use", block);
    await db.update(brands).set({ deletedAt: now() }).where(eq(brands.id, b.id));
    return c.json({ ok: true });
  });
