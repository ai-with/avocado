import type { Context } from "hono";
import { z } from "zod";
import { and, desc, eq, max } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { approvals, consents, guideInfluencers, guides, influencers, reviewRounds, submissions } from "../../db/schema";
import { ApiError } from "../../lib/errors";
import { now } from "../../lib/ids";
import { workspaceCtx } from "../../middleware/auth";
import { PROCESSING_DELAY_MS, type ReviewState } from "../../../shared/review";

// 검수 라우트 공용 (F-60~F-62)

export const BRAND_LANG = "ko";

type Sub = typeof submissions.$inferSelect;
type Inf = typeof influencers.$inferSelect;

export function reviewState(s: Pick<Sub, "id" | "status">, approvedSubId: string | null, sent: boolean): ReviewState {
  if (approvedSubId === s.id) return "approved";
  if (s.status === "uploaded") return "waiting";
  if (s.status === "processing") return "processing";
  if (sent) return "feedback_sent";
  return "needs_review";
}
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
  if (!row) throw new ApiError(404, "submission_not_found", "검수할 영상을 찾을 수 없습니다.");
  return { ...row, workspace, user };
}

export function approvalOf(db: Db, giId: string) {
  return db.select().from(approvals).where(eq(approvals.guideInfluencerId, giId)).get();
}

// 승인 후 코멘트 잠금 (F-62)
export async function assertUnlocked(db: Db, giId: string) {
  if (await approvalOf(db, giId)) throw new ApiError(409, "approved_locked", "최종 승인된 뒤에는 피드백을 바꿀 수 없습니다.");
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
