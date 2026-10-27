import type { Context } from "hono";
import { z } from "zod";
import { and, desc, eq, max } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { approvals, consents, guideInfluencers, guides, influencers, reviewRounds, submissions, supersededVersions } from "../../db/schema";
import { ApiError } from "../../lib/errors";
import { now } from "../../lib/ids";
import { workspaceCtx } from "../../middleware/auth";
import { PROCESSING_DELAY_MS } from "../../../shared/review";
import { isLocked, type ApprovedRef } from "./policy";

export { reviewState } from "./policy";

// 검수 라우트 공용 (F-60~F-62)

export const BRAND_LANG = "ko";

type Sub = typeof submissions.$inferSelect;
type Inf = typeof influencers.$inferSelect;

export const isDelayed = (s: Pick<Sub, "status" | "uploadedAt">) => (s.status === "uploaded" || s.status === "processing") && !!s.uploadedAt && now() - s.uploadedAt > PROCESSING_DELAY_MS;

export const fileUrl = (key: string) => `/api/files/${key}`;

// 이 워크스페이스의 검수 대상 영상 한 건과 가이드·인플루언서
export async function loadSub(c: Context<AppEnv>, id: string) {
  const { workspace, user } = workspaceCtx(c);
  const row = await c.var.db
    .select({ sub: submissions, gi: guideInfluencers, guide: guides, influencer: influencers })
    .from(submissions)
    .innerJoin(guideInfluencers, eq(guideInfluencers.id, submissions.guideInfluencerId))
    .innerJoin(guides, eq(guides.id, guideInfluencers.guideId))
    .innerJoin(influencers, eq(influencers.id, guideInfluencers.influencerId))
    .where(and(eq(submissions.id, id), eq(guides.workspaceId, workspace.id)))
    .get();
  if (!row) throw new ApiError(404, "submission_not_found", "검수할 영상을 찾을 수 없어요.");
  return { ...row, workspace, user };
}

export function approvalOf(db: Db, giId: string) {
  return db.select().from(approvals).where(eq(approvals.guideInfluencerId, giId)).get();
}

// 승인된 버전 번호까지 붙인 승인 정보
export async function approvedRefOf(db: Db, giId: string): Promise<ApprovedRef> {
  const row = await db.select({ submissionId: approvals.submissionId, version: submissions.version }).from(approvals).innerJoin(submissions, eq(submissions.id, approvals.submissionId)).where(eq(approvals.guideInfluencerId, giId)).get();
  return row ?? null;
}

export async function isSuperseded(db: Db, subId: string) {
  return !!(await db.select({ id: supersededVersions.submissionId }).from(supersededVersions).where(eq(supersededVersions.submissionId, subId)).get());
}

// 승인 후 코멘트 잠금 (F-62). 승인 뒤 올라온 새 버전은 검수할 수 있다 (340)
export async function assertUnlocked(db: Db, sub: Pick<Sub, "id" | "version" | "guideInfluencerId">) {
  if (isLocked(sub, await approvedRefOf(db, sub.guideInfluencerId), await isSuperseded(db, sub.id)))
    throw new ApiError(409, "approved_locked", "최종 승인된 버전은 피드백을 바꿀 수 없어요.");
}

export async function influencerEmail(db: Db, giId: string, inf: Inf) {
  if (inf.email) return inf.email;
  const c = await db.select({ email: consents.email }).from(consents).where(eq(consents.guideInfluencerId, giId)).orderBy(desc(consents.agreedAt)).get();
  return c?.email ?? null;
}

export async function lastRoundN(db: Db, giId: string) {
  const r = await db.select({ n: max(reviewRounds.n) }).from(reviewRounds).where(eq(reviewRounds.guideInfluencerId, giId)).get();
  return r?.n ?? 0;
}

// 업로드 페이지 '이전 피드백 보기' 노출용 (v2부터)
export const sentRoundCount = lastRoundN;

export const shapeSchema = z.object({ type: z.enum(["box", "arrow"]), x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(-1).max(1), h: z.number().min(-1).max(1) }).nullable();
export const feedbackBody = z.object({
  frameId: z.string().nullable(),
  tMs: z.number().int().nonnegative(),
  shape: shapeSchema,
  text: z.string().trim().min(1, "코멘트를 입력해 주세요.").max(2000),
});
export const postUrlBody = z.object({ url: z.url({ protocol: /^https$/, error: "https 로 시작하는 게시물 주소를 넣어 주세요." }).max(500), replace: z.boolean().default(false) });
