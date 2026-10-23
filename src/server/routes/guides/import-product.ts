import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../types";
import { ApiError, parse } from "../../lib/errors";
import { AI_MODELS, jsonOf } from "../../lib/ai";
import { UnsafeUrlError, fetchHtmlSafely, unsafeUrlReason } from "../../lib/safe-fetch";
import { extractProductPage, type ProductPage } from "../../lib/product-page";
import { editorsOnly } from "../../middleware/auth";

// 상품 URL 로 가이드 기본 정보 채우기 (F-56 보강). DB 에 저장하지 않고 폼에 넣을 값만 돌려준다
const AI_TIMEOUT_MS = 30_000;
const AI_MAX_TOKENS = 600;
const BENEFIT_COUNT = 3;
// 가이드 저장 스키마(schemas.ts)의 상한과 맞춘다
const LIMITS = { name: 80, benefit: 120, usage: 1000, purpose: 300 } as const;

const AI_PROMPT = `You read a product web page and fill a brand's short-form video guide form.
Return ONLY a JSON object: {"name": string, "benefits": string[] (exactly 3), "usage": string, "purposeSuggestion": string}.
All values in Korean. "name": product name. "benefits": the 3 key benefits the page states, one short phrase each.
"usage": how to use, 1 to 3 sentences. "purposeSuggestion": one short line for the video purpose, such as 광고 소재용 UGC.
Never invent benefits, numbers or claims that are not on the page. Use "" when the page does not say.
No medical expressions (치료, 완치, 의약품 효능 등).`;

const importBody = z.object({
  url: z.string().trim().min(1, "상품 페이지 주소를 넣어 주세요.").max(2000, "주소가 너무 길어요.").regex(/^https?:\/\//i, "http 또는 https 주소만 가져올 수 있어요."),
});
const aiOutput = z.object({ name: z.string(), benefits: z.array(z.string()), usage: z.string(), purposeSuggestion: z.string() });
type Summary = z.infer<typeof aiOutput>;

const FETCH_MESSAGES: Record<string, string> = {
  not_html: "HTML 페이지가 아니에요. 상품 상세 페이지 주소를 넣어 주세요.",
  too_many_redirects: "주소 이동이 너무 많아 멈췄어요.",
  TimeoutError: "10초 안에 응답이 없어 멈췄어요.",
  status_404: "페이지가 없어요(404). 상품 상세 페이지 주소가 맞는지 확인해 주세요.",
  status_403: "사이트가 자동 읽기를 막았어요(403). 제품 정보를 직접 입력해 주세요.",
};

const urlError = (message: string, status: 400 | 422 = 400) => new ApiError(status, "product_import_failed", message, { url: message });

async function loadPage(url: string): Promise<ProductPage> {
  if (unsafeUrlReason(url)) throw urlError("내부망·IP·localhost 주소는 가져올 수 없어요. 공개된 상품 페이지 주소를 넣어 주세요.");
  try {
    const { html, finalUrl } = await fetchHtmlSafely(url);
    return extractProductPage(html, finalUrl);
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw urlError("이동한 주소가 내부망·IP 주소라 멈췄어요.");
    const key = e instanceof Error ? (e.name === "TimeoutError" ? e.name : e.message) : "";
    console.error("[guide:import-product]", key);
    throw urlError(FETCH_MESSAGES[key] ?? "페이지를 가져오지 못했어요. 주소가 맞는지 확인해 주세요.", 422);
  }
}

const cut = (s: string, max: number) => s.trim().slice(0, max);

function fitBenefits(list: string[]): string[] {
  const kept = list.map((b) => cut(b, LIMITS.benefit)).filter(Boolean).slice(0, BENEFIT_COUNT);
  return [...kept, ...Array<string>(BENEFIT_COUNT).fill("")].slice(0, BENEFIT_COUNT);
}

// 모델 없이 페이지 메타 값만으로 채운다. 효능은 설명 문장을 앞에서부터 쓴다
function metaSummary(page: ProductPage): Summary {
  const sentences = page.description.split(/(?<=[.!?。])\s+/).filter(Boolean);
  return { name: page.name, benefits: sentences, usage: "", purposeSuggestion: "" };
}

async function askModel(env: Env, page: ProductPage): Promise<Summary | null> {
  const run = env.AI.run(AI_MODELS.text, {
    messages: [
      { role: "system", content: AI_PROMPT },
      { role: "user", content: JSON.stringify({ title: page.name, description: page.description, pageText: page.text }) },
    ],
    max_tokens: AI_MAX_TOKENS,
  }) as Promise<{ response?: unknown }>;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_TIMEOUT_MS));
  const out = await Promise.race([run, timeout]);
  if (!out) return null;
  const parsed = aiOutput.safeParse(jsonOf(out.response));
  return parsed.success ? parsed.data : null;
}

async function summarize(env: Env, page: ProductPage): Promise<{ summary: Summary; fallback: boolean }> {
  // 로컬·테스트용. 다른 AI 호출과 같이 AI_FAKE=1 이면 모델을 부르지 않는다
  if (env.AI_FAKE === "1") return { summary: metaSummary(page), fallback: false };
  try {
    const summary = await askModel(env, page);
    if (summary) return { summary, fallback: false };
  } catch (e) {
    console.error("[guide:import-product] ai", e);
  }
  return { summary: metaSummary(page), fallback: true };
}

export const importProductRoutes = new Hono<AppEnv>().post("/import-product", editorsOnly, async (c) => {
  const { url } = parse(importBody, await c.req.json());
  const page = await loadPage(url);
  if (!page.name && !page.description && !page.text) throw urlError("페이지에서 상품 정보를 찾지 못했어요. 로그인이 필요하거나 화면을 스크립트로 그리는 페이지일 수 있어요.", 422);
  const { summary, fallback } = await summarize(c.env, page);
  return c.json({
    product: { name: cut(summary.name || page.name, LIMITS.name), benefits: fitBenefits(summary.benefits), usage: cut(summary.usage, LIMITS.usage), photos: page.images },
    purposeSuggestion: cut(summary.purposeSuggestion, LIMITS.purpose),
    sourceUrl: url,
    fallback,
  });
});
