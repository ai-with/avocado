import { judgeText } from "../../lib/ai";
import { adDisclosureHits, checkFormat, fromTextVerdict, mainLang, openingWindowMs, parseLangRule, phraseHits, splitTerms, worst, type Seg, type Verdict } from "../rules";
import type { Sub } from "../context";
import type { VisualJudge } from "./detect-visual";
import { splitNames, type GuideRule } from "../../../shared/guides";
import { josa } from "../../../shared/josa";

// 규칙 종류별 판정. 규칙 하나에 판정 하나

export type Judged = { verdict: Verdict; model: string; frameIds?: string[]; segmentIds?: string[] };
export type DetectInput = { env: Env; sub: Sub; segs: Seg[]; noSpeech: Verdict | null; visual: VisualJudge; textModel: string; visionModel: string };

const UNDETERMINED_TARGET: Verdict = { result: "undetermined", confidence: "low", reason: "검사 대상이 없어요." };
const UNDETERMINED_FORMAT: Verdict = { result: "undetermined", confidence: "low", reason: "형식 규칙을 해석하지 못했어요. 직접 확인해 주세요." };
const langLabel = (l: string) => (l === "ko" ? "한국어" : l === "en" ? "영어" : l);

async function judgeTextSafe(env: Env, rule: GuideRule, segs: Seg[]): Promise<{ verdict: Verdict; segmentIds: string[] }> {
  try {
    const v = await judgeText(env, { type: rule.type, content: rule.content }, segs.map((s) => ({ id: s.id, text: s.text, translated: s.translatedText })));
    const known = new Set(segs.map((s) => s.id));
    return { verdict: fromTextVerdict(v), segmentIds: v.segment_ids.filter((id) => known.has(id)) };
  } catch (e) {
    // 모델 응답 형식 오류 → 그 규칙만 판단 불가
    console.error("[pipeline:judgeText]", rule.id, e);
    return { verdict: { result: "undetermined", confidence: "low", reason: "모델 응답을 해석하지 못했어요." }, segmentIds: [] };
  }
}

async function byModel(rule: GuideRule, d: DetectInput): Promise<Judged> {
  const v = await judgeTextSafe(d.env, rule, d.segs);
  return { verdict: v.verdict, model: d.textModel, segmentIds: v.segmentIds };
}

function forbiddenPhrase(rule: GuideRule, d: DetectInput): Judged {
  const hit = phraseHits(d.segs, splitTerms(rule.content));
  if (hit.ids.length) return { verdict: { result: "candidate", confidence: "high", reason: `대사에 금지 표현 "${hit.terms.join('", "')}"이 있어요.` }, model: "rule", segmentIds: hit.ids };
  return { verdict: { result: "compliant", confidence: "medium", reason: "대사에서 금지 표현을 찾지 못했어요." }, model: "rule" };
}

const competitorReason = (names: string[]) => names.map((n) => `경쟁사 이름 '${n}'${josa(n, "이/가")} 나와요.`).join(" ");

// 대사는 금지 표현과 같은 문자열 매칭, 화면 텍스트는 프레임 질문 표로 본다. 캡션은 저장된 텍스트가 없어 보지 않는다
export function competitorMention(rule: GuideRule, d: DetectInput): Judged {
  let v: Verdict | null = null;
  let segmentIds: string[] = [];
  let frameIds: string[] = [];
  if (rule.targets.includes("speech")) {
    const hit = phraseHits(d.segs, splitNames(rule.content));
    segmentIds = hit.ids;
    v = d.noSpeech ?? (hit.ids.length ? { result: "candidate", confidence: "high", reason: `대사: ${competitorReason(hit.terms)}` } : { result: "compliant", confidence: "medium", reason: "대사에서 경쟁사 이름을 찾지 못했어요." });
  }
  const screenText = rule.targets.includes("screen_text");
  if (screenText) {
    const s = d.visual(rule.id, "forbidden");
    frameIds = s.frameIds;
    v = v ? worst(v, { ...s, reason: `화면: ${s.reason}` }) : { ...s, reason: `화면: ${s.reason}` };
  }
  return { verdict: v ?? UNDETERMINED_TARGET, model: screenText ? d.visionModel : "rule", frameIds, segmentIds };
}

// 그대로는 없으면 비슷한 표현으로 말했는지 모델에 묻는다
async function requiredPhrase(rule: GuideRule, d: DetectInput): Promise<Judged> {
  const hit = phraseHits(d.segs, [rule.content]);
  if (hit.ids.length) return { verdict: { result: "compliant", confidence: "high", reason: "대사에서 필수 문구를 찾았어요." }, model: "rule", segmentIds: hit.ids };
  return byModel(rule, d);
}

async function language(rule: GuideRule, d: DetectInput): Promise<Judged> {
  const want = parseLangRule(rule.content);
  const got = mainLang(d.segs);
  if (!want || !got) return byModel(rule, d);
  const verdict: Verdict =
    want === got ? { result: "compliant", confidence: "high", reason: `대사 언어: ${langLabel(got)}` } : { result: "candidate", confidence: "high", reason: `대사 언어가 규칙과 달라요 (대사: ${langLabel(got)}, 규칙: ${langLabel(want)}).` };
  return { verdict, model: "rule" };
}

function adDisclosure(rule: GuideRule, d: DetectInput): Judged {
  let v: Verdict | null = null;
  let segmentIds: string[] = [];
  let frameIds: string[] = [];
  if (rule.targets.includes("speech")) {
    segmentIds = adDisclosureHits(d.segs);
    v = d.noSpeech ?? (segmentIds.length ? { result: "compliant", confidence: "high", reason: "대사에서 광고 표기를 찾았어요." } : { result: "candidate", confidence: "medium", reason: "대사에서 광고 표기를 찾지 못했어요." });
  }
  const screenText = rule.targets.includes("screen_text");
  if (screenText) {
    const s = d.visual(rule.id, "required");
    frameIds = s.frameIds;
    const screen: Verdict = s.result === "candidate" ? { ...s, reason: `화면 광고 표기: ${s.reason}` } : { ...s, reason: `화면: ${s.reason}` };
    v = v ? worst(v, screen) : screen;
  }
  return { verdict: v ?? UNDETERMINED_TARGET, model: screenText ? d.visionModel : "rule", frameIds, segmentIds };
}

function format(rule: GuideRule, d: DetectInput): Judged {
  const code = checkFormat(rule.content, { durationS: d.sub.durationS, width: d.sub.width, height: d.sub.height });
  const opening = openingWindowMs(rule.content) != null ? d.visual(rule.id, "required") : null;
  if (code && opening) return { verdict: worst(code, opening), model: `rule+${d.visionModel}`, frameIds: opening.frameIds };
  if (opening) return { verdict: opening, model: d.visionModel, frameIds: opening.frameIds };
  if (code) return { verdict: code, model: "rule" };
  return { verdict: UNDETERMINED_FORMAT, model: "rule" };
}

// 대사 기반 규칙은 음성이 없으면 판단 불가로 둔다
const SPEECH_RULES = new Set<GuideRule["type"]>(["forbidden_phrase", "required_phrase", "language"]);

export async function judgeRule(rule: GuideRule, d: DetectInput): Promise<Judged | null> {
  if (SPEECH_RULES.has(rule.type) && d.noSpeech) return { verdict: d.noSpeech, model: "rule" };
  switch (rule.type) {
    case "forbidden_phrase":
      return forbiddenPhrase(rule, d);
    case "required_phrase":
      return requiredPhrase(rule, d);
    case "language":
      return language(rule, d);
    case "ad_disclosure":
      return adDisclosure(rule, d);
    case "required_scene":
    case "forbidden_scene": {
      const s = d.visual(rule.id, rule.type === "required_scene" ? "required" : "forbidden");
      return { verdict: s, model: d.visionModel, frameIds: s.frameIds };
    }
    case "format":
      return format(rule, d);
    case "competitor_mention":
      return competitorMention(rule, d);
  }
  return null;
}
