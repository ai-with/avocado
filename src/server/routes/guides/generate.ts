import { z } from "zod";
import type { guides } from "../../db/schema";
import { checklistFromRules, emptyVideoGuide, forbiddenTerms, type GuideRule, type SceneKey, type VideoGuide } from "../../../shared/guides";

// 영상 가이드 초안 생성 (F-56). 실패하거나 형식이 틀리면 빈 초안(fallback)을 돌려준다

// 3.1-8b-instruct 는 2026-05-30 지원 종료
const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const AI_TIMEOUT_MS = 30_000;
const AI_MAX_TOKENS = 1200;
const MAX_TIPS = 5;
const LOG_PREVIEW_CHARS = 500;

const AI_PROMPT = `You write short-form video (Reels, Shorts, TikTok) creator guides for brands.
Return ONLY a JSON object, no prose, with this shape:
{"purposeLine": string (Korean, one line),
 "scenes": [{"key": "hook"|"usage"|"result"|"closing", "description": string (Korean), "lineEn": string (English sample line), "lineKo": string (Korean sample line)}] (exactly 4, in that key order),
 "tips": string[] (Korean, 3 to 5 shooting tips: lighting, vertical 9:16, no silent gaps)}
Never use any forbidden phrase given. Do not claim medical or exaggerated effects.`;

const aiOutput = z.object({
  purposeLine: z.string(),
  scenes: z.array(z.object({ key: z.enum(["hook", "usage", "result", "closing"]), description: z.string(), lineEn: z.string(), lineKo: z.string() })),
  tips: z.array(z.string()),
});

type Guide = typeof guides.$inferSelect;
type DraftResult = { guide: VideoGuide; model: string | null; fallback: boolean };

function baseDraft(guide: Guide, rules: GuideRule[]): VideoGuide {
  const base = emptyVideoGuide();
  base.checklist = checklistFromRules(rules);
  base.deliverables = [guide.deliverables.final ? "완성본" : "", guide.deliverables.clean ? "클린본(자막·음악 없는 버전)" : "", guide.deliverables.note].filter(Boolean).join(", ");
  return base;
}

function modelInput(guide: Guide, rules: GuideRule[]) {
  const enabledOf = (type: GuideRule["type"]) => rules.filter((r) => r.enabled && r.type === type).map((r) => r.content);
  return {
    product: guide.product,
    purpose: guide.purpose,
    lengthSeconds: guide.lengthS,
    creatorLanguage: guide.lang,
    requiredPhrases: enabledOf("required_phrase"),
    forbiddenPhrases: forbiddenTerms(rules),
    requiredScenes: enabledOf("required_scene"),
  };
}

// 응답이 오지 않으면 null
async function askModel(env: Env, input: object) {
  const run = env.AI.run(AI_MODEL, {
    messages: [
      { role: "system", content: AI_PROMPT },
      { role: "user", content: JSON.stringify(input) },
    ],
    max_tokens: AI_MAX_TOKENS,
  }) as Promise<{ response?: string | object }>;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_TIMEOUT_MS));
  return Promise.race([run, timeout]);
}

function mergeOutput(base: VideoGuide, out: z.infer<typeof aiOutput>) {
  const byKey = new Map(out.scenes.map((s) => [s.key, s]));
  base.purposeLine = out.purposeLine;
  base.scenes = base.scenes.map((s) => {
    const g = byKey.get(s.key as SceneKey);
    return g ? { ...s, description: g.description, lineEn: g.lineEn, lineKo: g.lineKo } : s;
  });
  if (out.tips.length) base.tips = out.tips.slice(0, MAX_TIPS);
}

export async function generateDraft(env: Env, guide: Guide, rules: GuideRule[]): Promise<DraftResult> {
  const base = baseDraft(guide, rules);
  // 로컬·테스트용. 다른 AI 호출(lib/ai.ts)과 같이 AI_FAKE=1 이면 모델을 부르지 않는다
  if (env.AI_FAKE === "1") {
    base.purposeLine = `${guide.product.name}을(를) 직접 써 본 경험을 자연스럽게 보여 주세요.`;
    return { guide: base, model: "fake", fallback: false };
  }
  try {
    const out = await askModel(env, modelInput(guide, rules));
    // 모델이 JSON 을 내면 Workers AI 가 이미 객체로 풀어 줄 때가 있다
    const res = out?.response ?? "";
    const text = typeof res === "string" ? res : JSON.stringify(res);
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = aiOutput.safeParse(typeof res === "string" ? JSON.parse(json || "null") : res);
    if (!parsed.success) {
      console.error("[guide:generate] 형식 불일치", out === null ? "timeout" : text.slice(0, LOG_PREVIEW_CHARS));
      return { guide: base, model: null, fallback: true };
    }
    mergeOutput(base, parsed.data);
    return { guide: base, model: AI_MODEL, fallback: false };
  } catch (e) {
    console.error("[guide:generate]", e);
    return { guide: base, model: null, fallback: true };
  }
}
