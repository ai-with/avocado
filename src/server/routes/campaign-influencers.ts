import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "../types";
import { guideInfluencers, guides } from "../db/schema";
import { ApiError, parse } from "../lib/errors";
import { editorsOnly, workspaceCtx } from "../middleware/auth";

// 캠페인 참여 인플루언서의 계약 기간 (TASK-074, AIWITH-508). 입력 화면은 조건 화면(AIWITH-489)에서 붙인다
const contractBody = z
  .object({ contractStartAt: z.number().int().nonnegative().nullable(), contractEndAt: z.number().int().nonnegative().nullable() })
  .refine((b) => b.contractStartAt === null || b.contractEndAt === null || b.contractEndAt >= b.contractStartAt, { message: "계약 종료일은 시작일보다 빠를 수 없어요.", path: ["contractEndAt"] });

export const campaignInfluencerRoutes = new Hono<AppEnv>().patch("/:giId/contract", editorsOnly, async (c) => {
  const body = parse(contractBody, await c.req.json());
  const { workspace } = workspaceCtx(c);
  const db = c.var.db;
  const row = await db
    .select({ id: guideInfluencers.id })
    .from(guideInfluencers)
    .innerJoin(guides, eq(guides.id, guideInfluencers.guideId))
    .where(and(eq(guideInfluencers.id, c.req.param("giId")), eq(guides.workspaceId, workspace.id)))
    .get();
  if (!row) throw new ApiError(404, "participation_not_found", "참여 정보를 찾을 수 없어요.");
  await db.update(guideInfluencers).set(body).where(eq(guideInfluencers.id, row.id));
  return c.json(body);
});
