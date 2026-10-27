import { describe, expect, it, vi } from "vitest";
import { generateDraft } from "../routes/guides/generate";
import { summarize } from "../routes/guides/import-product";
import { SCRIPT_RETRY_HINT } from "./ai";
import type { ProductPage } from "./product-page";

type Guide = Parameters<typeof generateDraft>[1];
type RunInput = { messages: { role: string; content: string }[] };

const GUIDE = {
  product: { name: "토스", benefits: [], usage: "", photos: [] },
  purpose: "광고 소재용 UGC",
  lengthS: 30,
  lang: "ko",
  deliverables: { final: true, clean: false, note: "" },
} as unknown as Guide;

const draft = (word: string) =>
  JSON.stringify({
    purposeLine: "광고 소재용 UGC 콘텐츠를 제작해보세요.",
    scenes: ["hook", "usage", "result", "closing"].map((key) => ({ key, description: `${word} 장면이에요. 손에 들고 시작해요.`, lineEn: "Hi!", lineKo: "안녕하세요!" })),
    tips: [`${word} 빛에서 찍어요`, "세로로 찍어요"],
  });

// 응답을 차례로 돌려주는 가짜 Workers AI. 받은 system 프롬프트를 기록한다
function fakeEnv(responses: string[]) {
  const prompts: string[] = [];
  const run = vi.fn(async (_model: string, input: RunInput) => {
    prompts.push(input.messages[0]!.content);
    return { response: responses[Math.min(prompts.length - 1, responses.length - 1)] };
  });
  return { env: { AI: { run } } as unknown as Env, prompts, run };
}

describe("generateDraft 외국 문자 재시도", () => {
  it("1회차에 한자가 섞이면 한글 지시를 붙여 다시 묻고 2회차 결과를 쓴다", async () => {
    const { env, prompts } = fakeEnv([draft("效果"), draft("자연")]);
    const r = await generateDraft(env, GUIDE, []);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain(SCRIPT_RETRY_HINT);
    expect(prompts[1]).toContain(SCRIPT_RETRY_HINT);
    expect(r.scriptWarning).toBe(false);
    expect(r.guide.scenes[0]!.description).toBe("자연 장면이에요. 손에 들고 시작해요.");
  });
  it("끝까지 섞이면 해당 문장을 빼고 경고를 켠다. 내부 용어 목적 줄은 기본 문장으로 바꾼다", async () => {
    const { env, run } = fakeEnv([draft("效果")]);
    const r = await generateDraft(env, GUIDE, []);
    expect(run).toHaveBeenCalledTimes(3);
    expect(r.scriptWarning).toBe(true);
    expect(r.fallback).toBe(false);
    expect(r.guide.scenes[0]!.description).toBe("손에 들고 시작해요.");
    expect(r.guide.tips).toEqual(["세로로 찍어요"]);
    expect(r.guide.purposeLine).toBe("토스를 직접 써 본 경험을 자연스럽게 보여 주세요.");
  });
});

describe("summarize 외국 문자 재시도", () => {
  const page: ProductPage = { name: "flex", description: "", text: "사람이 챙기기 전에", images: [] };
  const summary = (benefit: string) => JSON.stringify({ name: "flex", benefits: [benefit, "근태 관리"], usage: "가입해요.", purposeSuggestion: "광고 소재용 UGC" });

  it("1회차 가나가 섞여도 2회차가 깨끗하면 그대로 쓴다", async () => {
    const { env, run } = fakeEnv([summary("人が 챙기기 전에"), summary("사람이 챙기기 전에")]);
    const r = await summarize(env, page);
    expect(run).toHaveBeenCalledTimes(2);
    expect(r.scriptWarning).toBe(false);
    expect(r.summary.benefits[0]).toBe("사람이 챙기기 전에");
    expect(r.summary.purposeSuggestion).toBe("");
  });
  it("끝까지 섞이면 그 칸만 비우고 경고를 켠다", async () => {
    const { env } = fakeEnv([summary("人が 챙기기 전에")]);
    const r = await summarize(env, page);
    expect(r.scriptWarning).toBe(true);
    expect(r.summary.benefits).toEqual(["", "근태 관리"]);
  });
});
