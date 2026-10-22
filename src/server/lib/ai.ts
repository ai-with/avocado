import { z } from "zod";

// F-60·F-61 모델 호출 어댑터. 모델을 바꿀 때는 이 파일만 고친다.
// AI_FAKE=1 이면 고정 응답을 돌려준다 (로컬에서 Workers AI 를 못 쓸 때 흐름 검증용)
export const AI_MODELS = {
  stt: "@cf/openai/whisper-large-v3-turbo",
  translate: "@cf/meta/m2m100-1.2b",
  // 3.1-8b-instruct 는 2026-05-30 지원 종료 (REPORT-018)
  text: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  vision: "@cf/meta/llama-3.2-11b-vision-instruct",
} as const;
export const PROMPT_VERSION = "v1";
const FAKE_MODEL = "fake";

const isFake = (env: Env) => env.AI_FAKE === "1";
export const modelName = (env: Env, kind: keyof typeof AI_MODELS) => (isFake(env) ? FAKE_MODEL : AI_MODELS[kind]);

export type RawSegment = { start: number; end: number; text: string; words?: { word: string; start: number; end: number }[] };
export type Transcription = { language: string | null; segments: RawSegment[] };

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function transcribe(env: Env, wav: ArrayBuffer): Promise<Transcription> {
  if (isFake(env))
    return {
      language: "en",
      segments: [
        { start: 0.4, end: 3.2, text: "Hi everyone, this is my new skincare routine." },
        { start: 3.4, end: 7.8, text: "Honestly it cured my acne in one week. Thanks for the gift!" },
      ],
    };
  const out = await env.AI.run(AI_MODELS.stt, { audio: toBase64(wav), vad_filter: true });
  return {
    language: out.transcription_info?.language ?? null,
    segments: (out.segments ?? [])
      .filter((s) => s.text?.trim())
      .map((s) => ({
        start: s.start ?? 0,
        end: s.end ?? s.start ?? 0,
        text: s.text!.trim(),
        words: s.words?.filter((w) => w.word !== undefined).map((w) => ({ word: w.word!, start: w.start ?? 0, end: w.end ?? 0 })),
      })),
  };
}

export async function translate(env: Env, text: string, from: string, to: string): Promise<string> {
  if (from === to) return text;
  if (isFake(env)) return to === "ko" ? `(자동 번역) ${text}` : `(auto) ${text}`;
  const out = (await env.AI.run(AI_MODELS.translate, { text, source_lang: from, target_lang: to })) as { translated_text?: string };
  const t = out.translated_text?.trim();
  if (!t) throw new Error("empty_translation");
  return t;
}

// 모델이 JSON 을 객체로 풀어 줄 때와 문자열로 줄 때가 모두 있다
function jsonOf(res: unknown): unknown {
  if (res && typeof res === "object") return res;
  const text = typeof res === "string" ? res : "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no_json");
  return JSON.parse(text.slice(start, end + 1));
}

const confidence = z.enum(["high", "medium", "low"]);
const textVerdict = z.object({
  verdict: z.enum(["violation", "compliant", "unclear"]),
  confidence,
  segment_ids: z.array(z.string()).default([]),
  reason: z.string().max(500),
});
export type TextVerdict = z.infer<typeof textVerdict>;

const TEXT_PROMPT = `You check a short-form video transcript against ONE brand guideline rule.
Return ONLY JSON: {"verdict":"violation"|"compliant"|"unclear","confidence":"high"|"medium"|"low","segment_ids":[ids of lines that are evidence],"reason":"one short Korean sentence"}.
"violation" means the transcript breaks the rule. Use "unclear" when the transcript does not give enough evidence.`;

export async function judgeText(env: Env, rule: { type: string; content: string }, lines: { id: string; text: string; translated: string | null }[]): Promise<TextVerdict> {
  if (isFake(env)) return { verdict: "unclear", confidence: "low", segment_ids: [], reason: "가짜 모델 응답입니다." };
  const out = (await env.AI.run(AI_MODELS.text, {
    messages: [
      { role: "system", content: TEXT_PROMPT },
      { role: "user", content: JSON.stringify({ rule, transcript: lines }) },
    ],
    max_tokens: 300,
  })) as { response?: unknown };
  return textVerdict.parse(jsonOf(out.response));
}

export type FrameAnswer = { id: string; yes: boolean; confidence: z.infer<typeof confidence> };

// 11B 비전 모델은 여러 질문을 JSON 으로 답하면 형식이 자주 깨진다. 질문마다 한 줄 "q1: yes|no|maybe" 로 받는다
const FRAME_PROMPT = `You look at ONE frame of a short-form video. Answer each question about what is visible in this frame.
Reply with one line per question and nothing else, in the form "q<number>: yes" or "q<number>: no" or "q<number>: maybe".
`;

export function parseFrameLines(text: string, ids: string[]): FrameAnswer[] {
  const out = new Map<string, FrameAnswer>();
  for (const m of text.matchAll(/q(\d+)\s*[:=)\-.]\s*\**\s*(yes|no|maybe)/gi)) {
    const id = ids[Number(m[1]) - 1];
    const a = m[2]!.toLowerCase();
    if (id && !out.has(id)) out.set(id, { id, yes: a !== "no", confidence: a === "maybe" ? "low" : "medium" });
  }
  if (out.size === 0) throw new Error("vision_format");
  return [...out.values()];
}

let visionAgreed = false;

// 프레임 한 장에 여러 규칙 질문을 한 번에 묻는다 (호출 수 = 프레임 수). 이미지 입력은 바이트 배열
export async function judgeFrame(env: Env, image: ArrayBuffer, questions: { id: string; question: string }[]): Promise<FrameAnswer[]> {
  if (isFake(env)) return questions.map((q) => ({ id: q.id, yes: false, confidence: "low" as const }));
  const prompt = FRAME_PROMPT + questions.map((q, i) => `q${i + 1}: ${q.question}`).join("\n");
  const input = { prompt, image: [...new Uint8Array(image)], max_tokens: 200 };
  const run = async () => ((await env.AI.run(AI_MODELS.vision, input)) as { response?: unknown }).response;
  let res: unknown;
  try {
    res = await run();
  } catch (e) {
    // Llama 3.2 Vision 은 계정마다 처음 한 번 라이선스 동의('agree')가 필요하다. 동의 응답도 오류(5016)로 온다
    if (visionAgreed || !String(e).toLowerCase().includes("agree")) throw e;
    await env.AI.run(AI_MODELS.vision, { prompt: "agree" }).catch(() => undefined);
    visionAgreed = true;
    res = await run();
  }
  return parseFrameLines(typeof res === "string" ? res : JSON.stringify(res), questions.map((q) => q.id));
}
