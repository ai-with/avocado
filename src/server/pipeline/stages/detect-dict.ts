import { phraseHits, squash, worst, type Seg, type Verdict } from "../rules";
import type { DetectInput, Judged } from "./detect-rules";
import type { DictRule } from "../../../shared/brand-terms";
import { josa } from "../../../shared/josa";

// 브랜드 검수 사전·법규 기본 목록 규칙 판정 (TASK-079). 문자열 매칭으로 끝나는 것은 모델을 부르지 않는다

const CAPTION_UNDETERMINED: Verdict = { result: "undetermined", confidence: "low", reason: "캡션은 저장된 글이 없어 아직 확인하지 못해요." };
const NO_TARGET: Verdict = { result: "undetermined", confidence: "low", reason: "검사 대상이 없어요." };
const NO_VARIANTS: Verdict = { result: "undetermined", confidence: "low", reason: "오표기·약칭을 등록하면 확인해요." };

type Part = { verdict: Verdict; segmentIds?: string[]; frameIds?: string[]; vision?: boolean };

const quoted = (terms: string[]) => terms.map((t) => `'${t}'`).join(", ");
const stripHash = (t: string) => t.replace(/^#/, "");

// 검사할 문자열과 맞았을 때의 이유. 금지어·제품명은 나오면 후보, 필수 멘트·해시태그는 없으면 후보
function plan(rule: DictRule): { terms: string[]; forbidden: boolean; hitReason: (hits: string[]) => string; missReason: string } {
  const o = rule.origin;
  if (o.kind === "product_name")
    return { terms: o.variants, forbidden: true, hitReason: (h) => `제품명 표기 오류: ${quoted(h)} 대신 '${o.term}'`, missReason: "제품명 오표기를 찾지 못했어요." };
  if (o.kind === "forbidden") {
    const tip = o.suggestion ? ` 대체 표현: ${o.suggestion}` : "";
    return { terms: [o.term, ...o.variants], forbidden: true, hitReason: (h) => `금지어 ${quoted(h)}${josa(h[h.length - 1] ?? "", "이/가")} 나와요.${tip}`, missReason: "금지어를 찾지 못했어요." };
  }
  const label = o.kind === "hashtag" ? "해시태그" : "필수 멘트";
  return { terms: [o.kind === "hashtag" ? stripHash(o.term) : o.term], forbidden: false, hitReason: () => `${label}를 찾았어요.`, missReason: `${label} '${o.term}'를 찾지 못했어요.` };
}

// 오표기가 바른 이름 안에 들어 있는 경우(약칭)를 바르게 쓴 문장에서 잡지 않도록 바른 이름을 먼저 지운다
const CUT = "\u0000";
function withoutCorrectName(segs: Seg[], name: string): Seg[] {
  const q = squash(name);
  const cut = (t: string) => squash(t).split(q).join(CUT);
  return segs.map((s) => ({ ...s, text: cut(s.text), translatedText: s.translatedText && cut(s.translatedText) }));
}

// 바른 이름을 품은 오표기(데모 워크플로우)는 원문에서, 바른 이름 안에 든 약칭(워크플로)은 바른 이름을 지운 문장에서 찾는다
function productNameHits(segs: Seg[], variants: string[], name: string) {
  const longer = variants.filter((v) => squash(v).includes(squash(name)));
  const a = phraseHits(segs, longer);
  const b = phraseHits(withoutCorrectName(segs, name), variants.filter((v) => !longer.includes(v)));
  return { ids: [...new Set([...a.ids, ...b.ids])], terms: [...a.terms, ...b.terms] };
}

function speechPart(rule: DictRule, d: DetectInput): Part {
  if (d.noSpeech) return { verdict: d.noSpeech };
  const p = plan(rule);
  const hit = rule.origin.kind === "product_name" ? productNameHits(d.segs, p.terms, rule.origin.term) : phraseHits(d.segs, p.terms);
  const found = hit.ids.length > 0;
  const verdict: Verdict = {
    result: p.forbidden === found ? "candidate" : "compliant",
    confidence: found ? "high" : "medium",
    reason: `대사: ${found ? p.hitReason(hit.terms) : p.missReason}`,
  };
  return { verdict, segmentIds: hit.ids };
}

function screenPart(rule: DictRule, d: DetectInput): Part {
  const s = d.visual(rule.id, plan(rule).forbidden ? "forbidden" : "required");
  return { verdict: { ...s, reason: `화면: ${s.reason}` }, frameIds: s.frameIds, vision: true };
}

// 금지어는 한 곳이라도 나오면 후보, 필수 항목은 한 곳이라도 찾으면 준수
function combine(verdicts: Verdict[], forbidden: boolean): Verdict {
  const found = verdicts.find((v) => v.result === "compliant");
  return !forbidden && found ? found : verdicts.reduce(worst);
}

// 비슷한 말을 허용하는 필수 멘트는 기존 required_phrase 판정(문자열 → 모델)으로 넘긴다
export function judgeDict(rule: DictRule, d: DetectInput): Judged | null {
  if (rule.origin.kind === "required_ment" && !rule.origin.exact) return null;
  if (rule.origin.kind === "product_name" && rule.origin.variants.length === 0) return { verdict: NO_VARIANTS, model: "rule" };
  const parts: Part[] = [];
  if (rule.targets.includes("speech")) parts.push(speechPart(rule, d));
  if (rule.targets.includes("screen_text")) parts.push(screenPart(rule, d));
  if (rule.targets.includes("caption")) parts.push({ verdict: CAPTION_UNDETERMINED });
  if (!parts.length) return { verdict: NO_TARGET, model: "rule" };
  return {
    verdict: combine(parts.map((p) => p.verdict), plan(rule).forbidden),
    model: parts.some((p) => p.vision) ? d.visionModel : "rule",
    segmentIds: parts.flatMap((p) => p.segmentIds ?? []),
    frameIds: parts.flatMap((p) => p.frameIds ?? []),
  };
}

// 화면 텍스트 대상 사전 규칙의 프레임 질문
export function dictQuestion(rule: DictRule): { question: string; kind: "required" | "forbidden" } | null {
  if (!rule.targets.includes("screen_text")) return null;
  const p = plan(rule);
  if (!p.terms.length) return null;
  if (p.forbidden) return { question: `Does any on-screen text in this frame show any of these words: ${p.terms.join(", ")}?`, kind: "forbidden" };
  return { question: `Does on-screen text in this frame show "${rule.origin.term}"?`, kind: "required" };
}
