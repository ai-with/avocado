// 메시지 템플릿 렌더 (TASK-073, AIWITH-484). 서버와 화면이 같이 쓴다. 본문 표기는 {{key}}

export const MESSAGE_LANGS = ["ko", "en"] as const;
export type MessageLang = (typeof MESSAGE_LANGS)[number];
export const LANG_LABEL: Record<MessageLang, string> = { ko: "한국어", en: "영어" };

export const TEMPLATE_PURPOSES = ["contact", "guide", "reminder", "feedback", "other"] as const;
export type TemplatePurpose = (typeof TEMPLATE_PURPOSES)[number];
export const PURPOSE_LABEL: Record<TemplatePurpose, string> = { contact: "컨택", guide: "가이드 안내", reminder: "리마인드", feedback: "피드백", other: "기타" };

// 기본 변수: 코드 상수라 수정·삭제할 수 없다. example 은 설정 화면 미리보기용(링크는 경로만)
export const SYSTEM_VARIABLES = [
  { key: "influencer_name", label: "인플루언서 이름", example: "달밤툰" },
  { key: "ig_handle", label: "인스타 핸들", example: "@dalbam_toon" },
  { key: "brand_name", label: "브랜드 이름", example: "데모 브랜드" },
  { key: "campaign_name", label: "캠페인 이름", example: "가을 신제품 캠페인" },
  { key: "guide_link", label: "가이드 링크", example: "/g/abc?lang=ko" },
  { key: "upload_link", label: "업로드 링크", example: "/u/abc?lang=ko" },
  { key: "feedback_link", label: "피드백 링크", example: "/f/abc?lang=ko" },
  { key: "deadline", label: "마감일", example: "2026년 11월 30일" },
  { key: "contract_start", label: "계약 시작일", example: "2026년 11월 1일" },
  { key: "contract_end", label: "계약 종료일", example: "2026년 11월 30일" },
  { key: "fee", label: "금액", example: "500,000원" },
  { key: "deliverables", label: "산출물", example: "릴스 1개" },
] as const;
// 설정 화면 미리보기 값. 링크 예시는 경로라 앱 주소(origin)를 앞에 붙인다
export const exampleValues = (origin: string): Record<string, string> =>
  Object.fromEntries(SYSTEM_VARIABLES.map((v) => [v.key, v.example.startsWith("/") ? `${origin}${v.example}` : v.example]));
export const SYSTEM_KEYS: ReadonlySet<string> = new Set(SYSTEM_VARIABLES.map((v) => v.key));

export const VAR_KEY_MAX = 40;
const KEY_RE = /^[a-z][a-z0-9_]*$/;
const TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

// 사용자 변수 key 검증. 문제가 없으면 null
export function varKeyProblem(key: string, takenKeys: Iterable<string>): string | null {
  if (!key) return "변수 이름(key)을 입력해 주세요.";
  if (key.length > VAR_KEY_MAX) return `변수 이름은 ${VAR_KEY_MAX}자 이하로 써 주세요.`;
  if (!KEY_RE.test(key)) return "영문 소문자로 시작하고 영문 소문자·숫자·밑줄(_)만 쓸 수 있어요.";
  if (SYSTEM_KEYS.has(key)) return "기본 변수와 같은 이름은 쓸 수 없어요.";
  for (const k of takenKeys) if (k === key) return "이미 있는 변수 이름이에요.";
  return null;
}

export const varToken = (key: string) => `{{${key}}}`;

// 본문에 나오는 변수 key (처음 나온 순서, 중복 없이)
export function keysIn(body: string): string[] {
  return [...new Set([...body.matchAll(TOKEN_RE)].map((m) => m[1]!))];
}

export type RenderPart = { text: string } | { key: string; value: string; state: "ok" | "empty" | "unknown" };
export type RenderResult = { text: string; parts: RenderPart[]; empty: string[]; unknown: string[] };

// 본문 + 값 사전 → 결과. 값 사전에 없는 key 는 없는 변수, 값이 빈 문자열이면 빠진 값. 둘 다 {{key}} 를 그대로 남긴다
export function renderMessage(body: string, values: Readonly<Record<string, string>>): RenderResult {
  const parts: RenderPart[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    if (m.index > last) parts.push({ text: body.slice(last, m.index) });
    const key = m[1]!;
    const value = Object.hasOwn(values, key) ? values[key]!.trim() : null;
    parts.push({ key, value: value || m[0], state: value === null ? "unknown" : value ? "ok" : "empty" });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  const keysWith = (state: "empty" | "unknown") => [...new Set(parts.flatMap((p) => ("key" in p && p.state === state ? [p.key] : [])))];
  return { text: parts.map((p) => ("key" in p ? p.value : p.text)).join(""), parts, empty: keysWith("empty"), unknown: keysWith("unknown") };
}

// 본문에서 정의되지 않은 key (편집 화면 경고)
export const unknownKeys = (body: string, known: ReadonlySet<string>) => keysIn(body).filter((k) => !known.has(k));

// 원하는 언어 본문이 비었으면 다른 언어로 대체한다. 둘 다 비었으면 null
export function pickBody(bodies: Partial<Record<MessageLang, string>>, wanted: MessageLang): { lang: MessageLang; body: string; fallback: boolean } | null {
  const order = [wanted, ...MESSAGE_LANGS.filter((l) => l !== wanted)];
  for (const lang of order) {
    const body = bodies[lang]?.trim();
    if (body) return { lang, body: bodies[lang]!, fallback: lang !== wanted };
  }
  return null;
}

// 변수를 쓰는 템플릿 이름 (삭제 경고)
export function templatesUsing(templates: { name: string; bodies: string[] }[], key: string): string[] {
  return templates.filter((t) => t.bodies.some((b) => keysIn(b).includes(key))).map((t) => t.name);
}
