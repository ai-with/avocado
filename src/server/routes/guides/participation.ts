import { Hono, type Context } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { guideInfluencers } from "../../db/schema";
import { parse } from "../../lib/errors";
import { findGuide, findGuideInfluencer } from "../../lib/guides";
import { addContactLog, changeStatus, contactLogsOf } from "../../lib/participation";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { PARTICIPATION_STATUSES } from "../../../shared/participation";

// 캠페인 인플루언서 한 줄의 진행 상태·조건·소통 이력 (/api/guides/:id/influencers/:giId/..., TASK-072)

const MAX_MEMO = 2000;
const MAX_AMOUNT = 1_000_000_000_000;
const statusBody = z.object({ status: z.enum(PARTICIPATION_STATUSES) });
const termsBody = z.object({
  amount: z.number().min(0).max(MAX_AMOUNT).nullable(),
  currency: z.string().trim().length(3).toUpperCase(),
  deliverables: z.string().trim().max(MAX_MEMO),
  memo: z.string().trim().max(MAX_MEMO),
  vars: z.record(z.string(), z.string().max(MAX_MEMO)).optional(),
});
const noteBody = z.object({ body: z.string().trim().min(1, "메모를 입력해 주세요.").max(MAX_MEMO) });

// 가이드가 이 워크스페이스 것이고, 줄이 그 가이드 것일 때만. 아니면 404
export async function ownRow(c: Context<AppEnv>) {
  const { workspace, user } = workspaceCtx(c);
  const g = await findGuide(c.var.db, workspace.id, c.req.param("id") ?? "");
  const gi = await findGuideInfluencer(c.var.db, g.id, c.req.param("giId") ?? "");
  return { workspaceId: workspace.id, userId: user.id, gi };
}

export const participationRoutes = new Hono<AppEnv>()
  // 마케터가 직접 바꾼다. 어떤 값으로나 갈 수 있고, 이후 사건은 다시 앞으로만 자동 전이한다
  .patch("/:id/influencers/:giId/status", editorsOnly, async (c) => {
    const { status } = parse(statusBody, await c.req.json());
    const { workspaceId, userId, gi } = await ownRow(c);
    await changeStatus(c.var.db, workspaceId, gi.id, gi.status, status, userId);
    return c.json({ status });
  })
  .patch("/:id/influencers/:giId/terms", editorsOnly, async (c) => {
    const terms = parse(termsBody, await c.req.json());
    const { gi } = await ownRow(c);
    // vars 는 다른 화면(484)이 채우므로 보내지 않으면 기존 값을 둔다
    const next = { ...terms, vars: terms.vars ?? gi.terms?.vars };
    await c.var.db.update(guideInfluencers).set({ terms: next }).where(eq(guideInfluencers.id, gi.id));
    return c.json({ terms: next });
  })
  .get("/:id/influencers/:giId/logs", async (c) => {
    const { gi } = await ownRow(c);
    return c.json({ logs: await contactLogsOf(c.var.db, gi.id) });
  })
  .post("/:id/influencers/:giId/logs", editorsOnly, async (c) => {
    const { body } = parse(noteBody, await c.req.json());
    const { workspaceId, userId, gi } = await ownRow(c);
    const log = await addContactLog(c.var.db, workspaceId, gi.id, { kind: "note", body, createdBy: userId });
    return c.json({ log }, 201);
  });
