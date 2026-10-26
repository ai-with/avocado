// F-60·F-61 순수 로직: 문장 분할, 언어 판정, 코드 규칙 매칭, 형식 계산, 프레임 샘플링, 판정 합산.
// 모델 호출과 DB 는 여기 두지 않는다 (단위 테스트 대상)
import type { CandidateConfidence, CandidateResult } from "../../shared/review";
import type { RawSegment, TextVerdict } from "../lib/ai";

export type Sentence = { startMs: number; endMs: number; text: string };
export type Seg = { id: string; startMs: number; text: string; translatedText: string | null; lang: string };
export type Verdict = { result: CandidateResult; confidence: CandidateConfidence; reason: string };

// Whisper 구간 하나에 문장이 여러 개면 글자 수 비율로 시간을 나눈다
export function toSentences(raw: RawSegment[]): Sentence[] {
  const out: Sentence[] = [];
  for (const seg of raw) {
    const parts = seg.text.split(/(?<=[.!?。？！])\s+/).map((p) => p.trim()).filter(Boolean);
    const startMs = Math.round(seg.start * 1000);
    const endMs = Math.max(startMs, Math.round(seg.end * 1000));
    const total = parts.reduce((a, p) => a + p.length, 0) || 1;
    let at = startMs;
    for (const [i, p] of parts.entries()) {
      const end = i === parts.length - 1 ? endMs : at + Math.round(((endMs - startMs) * p.length) / total);
      out.push({ startMs: at, endMs: end, text: p });
      at = end;
    }
  }
  return out;
}

// 한/영 판정은 한글 비율로 한다. Whisper 의 언어 추정은 짧은 영어 대사를 ko 로 잘못 줄 때가 있어 글자가 없을 때만 쓴다
export function detectLang(text: string, hint: string | null): string {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (!letters) return hint ? hint.toLowerCase().slice(0, 2) : "en";
  const hangul = letters.replace(/[^\uac00-\ud7a3\u3131-\u318e]/g, "").length;
  return hangul / letters.length >= 0.3 ? "ko" : "en";
}

export const otherLang = (lang: string) => (lang === "ko" ? "en" : "ko");

// 대소문자·공백 무시 단순 포함
export const squash = (s: string) => s.toLowerCase().replace(/[\s\p{P}]+/gu, "");

export function splitTerms(content: string): string[] {
  return content
    .split(/[,，/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 문구가 원문이나 번역에 들어간 문장 id 와 맞은 문구
export function phraseHits(segs: Seg[], terms: string[]): { ids: string[]; terms: string[] } {
  const ids = new Set<string>();
  const hit = new Set<string>();
  for (const t of terms) {
    const q = squash(t);
    if (!q) continue;
    for (const s of segs)
      if (squash(s.text).includes(q) || (s.translatedText && squash(s.translatedText).includes(q))) {
        ids.add(s.id);
        hit.add(t);
      }
  }
  return { ids: [...ids], terms: [...hit] };
}

// 광고 표기로 볼 표현 (표시광고법 추천·보증 심사지침, FTC 예시) [추론: 목록은 운영하며 늘린다]
export const AD_TERMS = ["광고", "협찬", "유료광고", "유료 광고", "제품 제공", "제품제공", "제공받", "#ad", "ad", "sponsored", "paid partnership", "partnership", "gifted", "gift"];

// 짧은 영어 단어(ad, gift)는 단어 경계로만 맞춘다
export function adDisclosureHits(segs: Seg[]): string[] {
  const ids: string[] = [];
  for (const s of segs) {
    const hay = `${s.text} ${s.translatedText ?? ""}`.toLowerCase();
    const ok = AD_TERMS.some((t) => (/^[#a-z ]+$/.test(t) ? new RegExp(`(^|[^a-z])${t.replace("#", "#?")}([^a-z]|$)`).test(hay) : hay.includes(t)));
    if (ok) ids.push(s.id);
  }
  return ids;
}

export function parseLangRule(content: string): "ko" | "en" | null {
  const c = content.toLowerCase();
  if (/영어|english/.test(c)) return "en";
  if (/한국어|한글|korean/.test(c)) return "ko";
  return null;
}

// 문장 수 기준 주 언어
export function mainLang(segs: Pick<Seg, "lang">[]): string | null {
  const n = new Map<string, number>();
  for (const s of segs) n.set(s.lang, (n.get(s.lang) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export type FormatMeta = { durationS: number | null; width: number | null; height: number | null };

// 형식 규칙 중 메타데이터로 계산할 수 있는 부분 (길이, 세로 비율). 해석할 게 없으면 null
export function checkFormat(content: string, meta: FormatMeta): Verdict | null {
  const c = content.toLowerCase();
  const problems: string[] = [];
  const checked: string[] = [];
  let unknown = false;

  const max = c.match(/(\d+)\s*(초|s|sec|seconds?)\s*(이하|이내|미만|까지|under|or less|max)/) ?? c.match(/(최대|max|under|up to)\s*(\d+)\s*(초|s|sec)/);
  const min = c.match(/(\d+)\s*(초|s|sec|seconds?)\s*(이상|넘게|over|or more|min)/);
  if (max || min) {
    if (meta.durationS == null) unknown = true;
    else {
      const d = meta.durationS;
      const maxS = max ? Number(/\d/.test(max[1] ?? "") ? max[1] : max[2]) : null;
      const minS = min ? Number(min[1]) : null;
      if (maxS != null) (d > maxS + 0.5 ? problems : checked).push(`길이 ${Math.round(d)}초 (최대 ${maxS}초)`);
      if (minS != null) (d < minS - 0.5 ? problems : checked).push(`길이 ${Math.round(d)}초 (최소 ${minS}초)`);
    }
  }
  if (/세로|9\s*:\s*16|vertical|portrait/.test(c)) {
    if (!meta.width || !meta.height) unknown = true;
    else (meta.height > meta.width ? checked : problems).push(`비율 ${meta.width}x${meta.height}${meta.height > meta.width ? " 세로" : " 가로"}`);
  }
  if (problems.length) return { result: "candidate", confidence: "high", reason: `형식이 달라요: ${problems.join(", ")}.` };
  if (unknown) return { result: "undetermined", confidence: "low", reason: "영상 길이나 크기 정보가 없어 형식을 계산하지 못했어요." };
  if (checked.length) return { result: "compliant", confidence: "high", reason: `형식 확인: ${checked.join(", ")}.` };
  return null;
}

// "첫 3초 안에 제품 노출" 같은 시작 구간 규칙이면 그 구간(ms)
export function openingWindowMs(content: string): number | null {
  const m = content.toLowerCase().match(/(첫|처음|first|opening)\s*(\d+)\s*(초|s|sec|seconds?)/);
  return m ? Number(m[2]) * 1000 : null;
}

// 균등 샘플 n장 + 지정 구간 안의 프레임 전부
export function sampleFrames<T extends { tMs: number }>(all: T[], n: number, windowMs: number | null): T[] {
  const sorted = [...all].sort((a, b) => a.tMs - b.tMs);
  const picked = new Set<T>();
  if (sorted.length <= n) sorted.forEach((f) => picked.add(f));
  else for (let i = 0; i < n; i++) picked.add(sorted[Math.round((i * (sorted.length - 1)) / (n - 1))]!);
  if (windowMs != null) for (const f of sorted) if (f.tMs <= windowMs) picked.add(f);
  return sorted.filter((f) => picked.has(f));
}

export type FrameVote = { frameId: string; yes: boolean; confidence: CandidateConfidence };

// 프레임별 예/아니오를 규칙 하나의 결과로 합친다. required = 어느 프레임에든 보여야 함, forbidden = 어느 프레임에도 보이면 안 됨
export function aggregateVotes(kind: "required" | "forbidden", votes: FrameVote[], asked: number): Verdict & { frameIds: string[] } {
  if (votes.length === 0) return { result: "undetermined", confidence: "low", reason: asked ? "모델 응답을 받지 못했어요." : "확인할 프레임이 없어요.", frameIds: [] };
  const yes = votes.filter((v) => v.yes);
  const strong = yes.filter((v) => v.confidence !== "low");
  const best: CandidateConfidence = strong.some((v) => v.confidence === "high") ? "high" : strong.length ? "medium" : "low";
  if (kind === "required") {
    if (strong.length) return { result: "compliant", confidence: best, reason: `프레임 ${strong.length}장에서 확인했어요.`, frameIds: strong.map((v) => v.frameId) };
    if (yes.length) return { result: "needs_check", confidence: "low", reason: "보이는 것 같지만 확실하지 않아요.", frameIds: yes.map((v) => v.frameId) };
    return { result: "candidate", confidence: "medium", reason: `확인한 프레임 ${votes.length}장에서 찾지 못했어요.`, frameIds: [] };
  }
  if (strong.length) return { result: "candidate", confidence: best, reason: `프레임 ${strong.length}장에서 보여요.`, frameIds: strong.map((v) => v.frameId) };
  if (yes.length) return { result: "needs_check", confidence: "low", reason: "보이는 것 같지만 확실하지 않아요.", frameIds: yes.map((v) => v.frameId) };
  return { result: "compliant", confidence: "medium", reason: `확인한 프레임 ${votes.length}장에서 보이지 않았어요.`, frameIds: [] };
}

// 텍스트 모델 판정 → 결과 4종. 위반 후보는 신뢰도 높음·중간만, 낮으면 확인 필요 (F-61 정책)
export function fromTextVerdict(v: TextVerdict): Verdict {
  if (v.verdict === "compliant") return { result: "compliant", confidence: v.confidence, reason: v.reason };
  if (v.verdict === "violation" && v.confidence !== "low") return { result: "candidate", confidence: v.confidence, reason: v.reason };
  return { result: "needs_check", confidence: "low", reason: v.reason };
}

const SEVERITY: Record<CandidateResult, number> = { compliant: 0, undetermined: 1, needs_check: 2, candidate: 3 };
// 두 판정 중 더 나쁜 쪽. 사유는 이어 붙인다
export function worst(a: Verdict, b: Verdict): Verdict {
  const [hi, lo] = SEVERITY[a.result] >= SEVERITY[b.result] ? [a, b] : [b, a];
  return { ...hi, reason: `${hi.reason} ${lo.reason}`.trim() };
}
