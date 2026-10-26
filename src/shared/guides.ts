// 가이드·규정·동의·업로드에서 서버와 클라이언트가 함께 쓰는 타입과 순수 로직

export const RULE_TYPES = ["required_phrase", "forbidden_phrase", "required_scene", "forbidden_scene", "ad_disclosure", "format", "language", "competitor_mention"] as const;
export type RuleType = (typeof RULE_TYPES)[number];
// 규정 세트 표(guideline_rules)는 type CHECK 제약이 있어 마이그레이션 전까지 경쟁사 규칙을 받지 않는다. 가이드 전용 규칙(JSON)만 받는다
export const SET_RULE_TYPES = RULE_TYPES.filter((t) => t !== "competitor_mention");
export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  required_phrase: "필수 문구",
  forbidden_phrase: "금지 표현",
  required_scene: "필수 장면",
  forbidden_scene: "금지 장면",
  ad_disclosure: "광고 표기",
  format: "형식",
  language: "언어",
  competitor_mention: "경쟁사 언급 금지",
};

export const RULE_TARGETS = ["speech", "screen_text", "scene", "caption"] as const;
export type RuleTarget = (typeof RULE_TARGETS)[number];
export const RULE_TARGET_LABELS: Record<RuleTarget, string> = { speech: "음성", screen_text: "화면 텍스트", scene: "화면 장면", caption: "캡션" };

export type RuleSeverity = "must" | "should";
export const SEVERITY_LABELS: Record<RuleSeverity, string> = { must: "필수", should: "권장" };

export type GuideRule = { id: string; type: RuleType; content: string; severity: RuleSeverity; targets: RuleTarget[]; enabled: boolean; version?: number };

export const DEFAULT_AD_RULE: Omit<GuideRule, "id"> = {
  type: "ad_disclosure",
  content: "영상 안에서 음성과 화면 텍스트로 브랜드와의 관계(광고, 협찬, 제품 제공)를 밝힌다",
  severity: "must",
  targets: ["speech", "screen_text"],
  enabled: true,
};

export type GuideProduct = { name: string; benefits: string[]; usage: string; photos: string[] };
export type SecondaryUseScope = { ads: boolean; media: string[]; regions: string[]; months: number };

export type SceneKey = "hook" | "usage" | "result" | "closing";
export type Scene = { key: SceneKey; title: string; description: string; lineEn: string; lineKo: string };
export type VideoGuide = {
  purposeLine: string;
  scenes: Scene[];
  tips: string[];
  checklist: string[];
  references: string[];
  deliverables: string;
  draft: boolean;
};

export const SCENE_TITLES: Record<SceneKey, string> = { hook: "0~3초 훅", usage: "사용 장면", result: "결과", closing: "마무리" };

export function emptyVideoGuide(): VideoGuide {
  return {
    purposeLine: "",
    scenes: (Object.keys(SCENE_TITLES) as SceneKey[]).map((key) => ({ key, title: SCENE_TITLES[key], description: "", lineEn: "", lineKo: "" })),
    tips: ["밝은 자연광이나 조명 아래에서 찍어 주세요", "세로(9:16)로 찍어 주세요", "말이 없는 무음 구간을 길게 두지 마세요"],
    checklist: [],
    references: [],
    deliverables: "",
    draft: true,
  };
}

const norm = (s: string) => s.trim().toLowerCase();

// F-55 예외: 필수 문구와 금지 표현이 서로 포함되면 충돌
export function ruleConflicts(rules: Pick<GuideRule, "type" | "content" | "enabled">[]): string[] {
  const on = rules.filter((r) => r.enabled && norm(r.content));
  const required = on.filter((r) => r.type === "required_phrase");
  const warnings: string[] = [];
  for (const req of required)
    for (const term of forbiddenTerms(on)) {
      const a = norm(req.content);
      const b = norm(term);
      if (a.includes(b) || b.includes(a)) warnings.push(`필수 문구 "${req.content}"와 금지 표현 "${term}"가 겹칩니다.`);
    }
  if (!on.some((r) => r.type === "ad_disclosure")) warnings.push("광고 표기 규칙이 없어요. 국가별 표기 의무를 확인하세요.");
  return warnings;
}

// 쉼표·줄바꿈으로 나눈 단어 목록 (금지 표현, 경쟁사 이름)
export const splitNames = (content: string) =>
  content
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

// 초안에 들어가면 안 되는 단어: 금지 표현과 경쟁사 이름
const AVOID_TYPES = new Set<RuleType>(["forbidden_phrase", "competitor_mention"]);
export function forbiddenTerms(rules: Pick<GuideRule, "type" | "content" | "enabled">[]): string[] {
  return rules.filter((r) => r.enabled && AVOID_TYPES.has(r.type)).flatMap((r) => splitNames(r.content));
}

// 대사 예시 중 금지 표현이 들어간 문장
export function lineWarnings(guide: VideoGuide, terms: string[]): string[] {
  const out: string[] = [];
  for (const s of guide.scenes)
    for (const line of [s.lineEn, s.lineKo]) {
      const hit = terms.find((t) => norm(line).includes(norm(t)));
      if (hit) out.push(`${s.title}: "${line}" 에 금지 표현 "${hit}"`);
    }
  return out;
}

// F-56: 체크리스트는 모델이 아니라 규칙에서 코드로 만든다
export function checklistFromRules(rules: Pick<GuideRule, "type" | "content" | "severity" | "enabled">[]): string[] {
  const prefix: Record<RuleType, string> = {
    required_phrase: "꼭 말하기",
    forbidden_phrase: "쓰지 않기",
    required_scene: "꼭 보여 주기",
    forbidden_scene: "보이지 않게 하기",
    ad_disclosure: "광고 표기",
    format: "형식",
    language: "언어",
    competitor_mention: "경쟁사 언급 안 하기",
  };
  return rules.filter((r) => r.enabled).map((r) => `[${r.severity === "must" ? "필수" : "권장"}] ${prefix[r.type]}: ${r.content}`);
}

// 한글 등 ASCII 로 바꿀 수 없는 이름은 랜덤 6자
export function makeSlug(name: string, random: () => string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const hasNonAscii = /[^\x00-\x7f]/.test(name);
  return ascii.length >= 3 && !hasNonAscii ? ascii : random();
}

export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const isTokenExpired = (expiresAt: number, at: number) => at >= expiresAt;

// F-59 상한 (초기값 추론)
export const UPLOAD_LIMITS = { maxBytes: 2 * 1024 ** 3, maxDurationS: 180, partBytes: 10 * 1024 ** 2, maxFrames: 180, staleMs: 24 * 60 * 60 * 1000 };
export const VIDEO_EXT = ["mp4", "mov", "webm"] as const;

export type UploadCheck = { ok: true } | { ok: false; reason: "too_large" | "too_long" | "bad_format" };
export function checkUpload(fileName: string, size: number, durationS: number): UploadCheck {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!(VIDEO_EXT as readonly string[]).includes(ext)) return { ok: false, reason: "bad_format" };
  if (size > UPLOAD_LIMITS.maxBytes) return { ok: false, reason: "too_large" };
  if (durationS > UPLOAD_LIMITS.maxDurationS) return { ok: false, reason: "too_long" };
  return { ok: true };
}

// F-58 동의 항목 (문구 초안, 법률 자문 전). 필수는 1, 2a, 2b, 3, 5, 6. 2c(2차 활용)는 선택이고 기록만 한다
export const CONSENT_DOC_VERSION = "2026-10-22.v1";
export const CONSENT_ITEMS = [
  { key: "collect", required: true },
  { key: "purpose_review", required: true },
  { key: "purpose_stt", required: true },
  { key: "secondary_use", required: false },
  { key: "automated", required: true },
  { key: "transfer", required: true },
  { key: "retention", required: true },
] as const;
// 체크 없이 읽고 넘어가는 고지 (4 생체정보, 7 광고 표시, 8 철회)
export const CONSENT_NOTICES = ["biometric", "ad_disclosure", "withdrawal"] as const;
export type ConsentKey = (typeof CONSENT_ITEMS)[number]["key"];

export const EU_COUNTRIES = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];

export function missingConsent(items: Partial<Record<string, boolean>>): string[] {
  return CONSENT_ITEMS.filter((i) => i.required && !items[i.key]).map((i) => i.key);
}
