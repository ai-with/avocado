import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { brands, campaigns, guideInfluencers, guidelineRules, guides, influencers, workspaces } from "../db/schema";
import { ApiError } from "./errors";
import { newId, newToken, now } from "./ids";
import { logEvent } from "./events";
import { findOwned } from "./owned";
import { resolveBrandName } from "./brands";
import { dictRules } from "./brand-terms";
import { TOKEN_TTL_MS, isTokenExpired, type GuideRule } from "../../shared/guides";

// 가이드·인플루언서 링크 공용 헬퍼. 브랜드 라우트, 공개 라우트, 처리 파이프라인이 같이 쓴다

export const findGuide = (db: Db, workspaceId: string, id: string) =>
  findOwned(db, guides, id, workspaceId, { code: "guide_not_found", message: "가이드를 찾을 수 없어요." });

// 가이드에 연결된 인플루언서 행 하나
export async function findGuideInfluencer(db: Db, guideId: string, giId: string) {
  const gi = await db.select().from(guideInfluencers).where(and(eq(guideInfluencers.id, giId), eq(guideInfluencers.guideId, guideId))).get();
  if (!gi) throw new ApiError(404, "link_not_found", "인플루언서 링크를 찾을 수 없어요.");
  return gi;
}

// 가이드에 적용되는 규칙 = 규정 세트의 규칙 + 가이드 전용 규칙. F-61 위반 탐지도 이걸 쓴다
export async function guideRules(db: Db, guide: { guidelineSetId: string | null; extraRules: GuideRule[] }): Promise<GuideRule[]> {
  const fromSet = guide.guidelineSetId
    ? await db.select().from(guidelineRules).where(eq(guidelineRules.setId, guide.guidelineSetId)).orderBy(asc(guidelineRules.createdAt))
    : [];
  return [...fromSet.map((r) => ({ id: r.id, type: r.type, content: r.content, severity: r.severity, targets: r.targets, enabled: r.enabled, version: r.version })), ...guide.extraRules];
}

// 검수에 쓰는 규칙 = 위 규칙 + 브랜드 검수 사전 규칙 (TASK-079). 사전 규칙 id 는 bt:, legal: 로 시작한다
export async function reviewRules(db: Db, guide: { guidelineSetId: string | null; extraRules: GuideRule[]; campaignId: string | null; brandTermExclusions: string[] }): Promise<GuideRule[]> {
  return [...(await guideRules(db, guide)), ...(await dictRules(db, guide))];
}

export const issueTokens = () => ({
  guideToken: newToken(),
  uploadToken: newToken(),
  feedbackToken: newToken(),
  connectToken: newToken(),
  tokenExpiresAt: now() + TOKEN_TTL_MS,
});

// 가이드에 인플루언서를 연결하고 토큰 4종을 발급한다. 이미 있으면 그대로 돌려준다
export async function linkInfluencer(db: Db, workspaceId: string, guideId: string, influencerId: string) {
  const existing = await db.select().from(guideInfluencers).where(and(eq(guideInfluencers.guideId, guideId), eq(guideInfluencers.influencerId, influencerId))).get();
  if (existing) return existing;
  const row = { id: newId(), guideId, influencerId, stage: "invited", createdAt: now(), ...issueTokens() };
  await db.insert(guideInfluencers).values(row);
  await logEvent(db, workspaceId, "guide_link_issued", { guide_id: guideId });
  return row;
}

export const guideLinks = (env: Env, gi: { guideToken: string; uploadToken: string; feedbackToken: string; connectToken: string }) => ({
  guide: `${env.APP_URL}/g/${gi.guideToken}`,
  upload: `${env.APP_URL}/u/${gi.uploadToken}`,
  feedback: `${env.APP_URL}/f/${gi.feedbackToken}`,
  connect: `${env.APP_URL}/connect/${gi.connectToken}`,
});

export type TokenColumn = "guideToken" | "uploadToken" | "feedbackToken";

// 인플루언서 공개 링크(/g, /u, /f) 토큰으로 찾는다. 없으면 null, 만료면 410
export async function findByToken(db: Db, column: TokenColumn, token: string) {
  const row = await db
    .select({ gi: guideInfluencers, guide: guides, influencer: influencers, workspaceName: workspaces.name, campaignBrand: brands.name })
    .from(guideInfluencers)
    .innerJoin(guides, eq(guides.id, guideInfluencers.guideId))
    .innerJoin(influencers, eq(influencers.id, guideInfluencers.influencerId))
    .innerJoin(workspaces, eq(workspaces.id, guides.workspaceId))
    .leftJoin(campaigns, eq(campaigns.id, guides.campaignId))
    .leftJoin(brands, and(eq(brands.id, campaigns.brandId), isNull(brands.deletedAt)))
    .where(eq(guideInfluencers[column], token))
    .get();
  if (!row) return null;
  if (isTokenExpired(row.gi.tokenExpiresAt, now())) throw new ApiError(410, "link_expired", "링크가 만료되었어요. 브랜드에 새 링크를 요청해 주세요.");
  // 공개 화면·메일에 보이는 이름은 캠페인 브랜드 이름 (TASK-070)
  const { campaignBrand, ...rest } = row;
  return { ...rest, brandName: resolveBrandName(campaignBrand, row.workspaceName) };
}

export const linkNotFound = () => new ApiError(404, "link_not_found", "링크를 찾을 수 없어요. 주소를 다시 확인해 주세요.");

// 이름·slug 만 필요한 곳(링크, 자료, 폼)에서 쓰는 가이드 확인
export async function getGuide(db: Db, workspaceId: string, guideId: string) {
  const { id, name, slug } = await findGuide(db, workspaceId, guideId);
  return { id, name, slug };
}
