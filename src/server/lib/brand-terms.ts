import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { brands, brandTerms, campaigns } from "../db/schema";
import { brandTermRules, type BrandTerm, type DictRule, type LegalPreset } from "../../shared/brand-terms";

// 브랜드 검수 사전을 캠페인(가이드) 규칙으로 (TASK-079). 검수 파이프라인, 검수 화면, 공개 가이드, 캠페인 편집이 쓴다

export type BrandTermRow = typeof brandTerms.$inferSelect;

export const toBrandTerm = (r: BrandTermRow): BrandTerm => ({
  id: r.id,
  kind: r.kind,
  term: r.term,
  variants: r.variants,
  suggestion: r.suggestion,
  match: r.match,
  severity: r.severity,
  targets: r.targets,
  note: r.note,
  enabled: r.enabled,
});

export const listBrandTerms = (db: Db, brandId: string) => db.select().from(brandTerms).where(eq(brandTerms.brandId, brandId)).orderBy(asc(brandTerms.createdAt));

type GuideRef = { campaignId: string | null; brandTermExclusions: string[] };

// 캠페인 브랜드의 사전 원본. 브랜드가 없거나 지워졌으면 null
async function brandDictOf(db: Db, guide: GuideRef): Promise<{ brandId: string; terms: BrandTerm[]; preset: LegalPreset } | null> {
  if (!guide.campaignId) return null;
  const brand = await db
    .select({ id: brands.id, enabled: brands.legalPresetEnabled, disabled: brands.legalPresetDisabled })
    .from(campaigns)
    .innerJoin(brands, and(eq(brands.id, campaigns.brandId), isNull(brands.deletedAt)))
    .where(eq(campaigns.id, guide.campaignId))
    .get();
  if (!brand) return null;
  const rows = await listBrandTerms(db, brand.id);
  return { brandId: brand.id, terms: rows.map(toBrandTerm), preset: { enabled: brand.enabled, disabled: brand.disabled } };
}

// 이번 캠페인에 적용되는 사전 규칙 (캠페인에서 끈 것 제외)
export async function dictRules(db: Db, guide: GuideRef): Promise<DictRule[]> {
  const dict = await brandDictOf(db, guide);
  return dict ? brandTermRules(dict.terms, dict.preset, guide.brandTermExclusions) : [];
}

// 캠페인 편집 화면: 끄기 전 전체 목록 + 꺼진 id + 사전 편집 주소용 브랜드 id
export async function dictRulesForEdit(db: Db, guide: GuideRef) {
  const dict = await brandDictOf(db, guide);
  if (!dict) return { brandId: null, rules: [], excluded: [] };
  const rules = brandTermRules(dict.terms, dict.preset, []);
  const ids = new Set(rules.map((r) => r.id));
  return { brandId: dict.brandId, rules, excluded: guide.brandTermExclusions.filter((id) => ids.has(id)) };
}
