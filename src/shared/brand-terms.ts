import type { GuideRule, RuleSeverity, RuleTarget } from "./guides";
import { COSMETIC_AD_TERMS, type LegalCategory, type LegalTerm } from "./cosmetic-ad-terms";

// 브랜드 검수 사전 (TASK-079). 사전 항목과 법규 기본 목록을 검수 규칙(GuideRule)로 바꾸는 순수 로직

export const TERM_KINDS = ["required_ment", "forbidden", "hashtag", "product_name"] as const;
export type TermKind = (typeof TERM_KINDS)[number];
export const TERM_KIND_LABELS: Record<TermKind, string> = { required_ment: "필수 멘트", forbidden: "금지어", hashtag: "해시태그", product_name: "제품명" };
export type TermMatch = "exact" | "similar";

export type BrandTerm = {
  id: string;
  kind: TermKind;
  term: string;
  variants: string[];
  suggestion: string | null;
  match: TermMatch;
  severity: RuleSeverity;
  targets: RuleTarget[];
  note: string;
  enabled: boolean;
};

export type LegalPreset = { enabled: boolean; disabled: string[] };

export type RuleOrigin = { source: "brand" | "legal"; kind: TermKind; term: string; variants: string[]; suggestion: string | null; exact: boolean };
export type DictRule = GuideRule & { origin: RuleOrigin };

export const BRAND_RULE_PREFIX = "bt:";
export const LEGAL_RULE_PREFIX = "legal:";
export type RuleSource = "brand" | "legal" | "guide";
export const RULE_SOURCE_LABELS: Record<RuleSource, string> = { brand: "브랜드 사전", legal: "법규 기본 목록", guide: "캠페인 규칙" };

export const ruleSource = (ruleId: string): RuleSource =>
  ruleId.startsWith(BRAND_RULE_PREFIX) ? "brand" : ruleId.startsWith(LEGAL_RULE_PREFIX) ? "legal" : "guide";

// 절대 표현과 기능성 표현은 맥락(기능성 심사 제품 등)에 따라 허용될 수 있어 권장으로 둔다
const LEGAL_SHOULD = new Set<LegalCategory>(["absolute", "functional"]);
// 법규 목록은 항목이 많아 대사 문자열 매칭만 한다. 화면 질문으로 넣으면 프레임마다 질문이 수십 개 붙는다
const LEGAL_TARGETS: RuleTarget[] = ["speech"];

const joinTerms = (term: string, variants: string[]) => [term, ...variants].join(", ");

function termContent(t: BrandTerm): string {
  if (t.kind === "product_name") return t.variants.length ? `${t.term} (오표기: ${t.variants.join(", ")})` : t.term;
  if (t.kind === "forbidden") return joinTerms(t.term, t.variants);
  return t.term;
}

export function brandTermRule(t: BrandTerm): DictRule {
  const type = t.kind === "forbidden" || t.kind === "product_name" ? "forbidden_phrase" : "required_phrase";
  return {
    id: `${BRAND_RULE_PREFIX}${t.id}`,
    type,
    content: termContent(t),
    severity: t.severity,
    targets: t.targets,
    enabled: true,
    origin: { source: "brand", kind: t.kind, term: t.term, variants: t.variants, suggestion: t.suggestion, exact: t.kind !== "required_ment" || t.match === "exact" },
  };
}

export function legalTermRule(t: LegalTerm): DictRule {
  return {
    id: `${LEGAL_RULE_PREFIX}${t.id}`,
    type: "forbidden_phrase",
    content: joinTerms(t.term, t.variants),
    severity: LEGAL_SHOULD.has(t.category) ? "should" : "must",
    targets: LEGAL_TARGETS,
    enabled: true,
    origin: { source: "legal", kind: "forbidden", term: t.term, variants: t.variants, suggestion: t.suggestion, exact: true },
  };
}

// 사전 항목 전부를 규칙으로. 꺼진 항목, 브랜드에서 끈 법규 항목, 이번 캠페인에서 끈 규칙(rule id)은 뺀다
export function brandTermRules(terms: BrandTerm[], preset: LegalPreset, exclusions: string[], legal: LegalTerm[] = COSMETIC_AD_TERMS): DictRule[] {
  const off = new Set(exclusions);
  const legalOff = new Set(preset.disabled);
  const fromBrand = terms.filter((t) => t.enabled).map(brandTermRule);
  const fromLegal = preset.enabled ? legal.filter((t) => !legalOff.has(t.id)).map(legalTermRule) : [];
  return [...fromBrand, ...fromLegal].filter((r) => !off.has(r.id));
}

// 공개 가이드에 보여 줄 사전 묶음. 번역하지 않고 항목 그대로 보낸다
export type PublicDictionary = {
  required: string[];
  hashtags: string[];
  products: { term: string; variants: string[] }[];
  forbidden: { term: string; variants: string[]; suggestion: string | null }[];
  legal: { term: string; suggestion: string | null }[];
};

export function publicDictionary(rules: DictRule[]): PublicDictionary {
  const of = (source: RuleOrigin["source"], kind: TermKind) => rules.filter((r) => r.origin.source === source && r.origin.kind === kind).map((r) => r.origin);
  return {
    required: of("brand", "required_ment").map((o) => o.term),
    hashtags: of("brand", "hashtag").map((o) => o.term),
    products: of("brand", "product_name").map(({ term, variants }) => ({ term, variants })),
    forbidden: of("brand", "forbidden").map(({ term, variants, suggestion }) => ({ term, variants, suggestion })),
    legal: of("legal", "forbidden").map(({ term, suggestion }) => ({ term, suggestion })),
  };
}

export const isDictRule = (r: GuideRule): r is DictRule => "origin" in r && r.origin !== undefined;
