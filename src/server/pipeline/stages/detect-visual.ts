import { eq } from "drizzle-orm";
import { frames } from "../../db/schema";
import { judgeFrame } from "../../lib/ai";
import { aggregateVotes, openingWindowMs, sampleFrames, type FrameVote, type Verdict } from "../rules";
import type { Ctx } from "../context";
import type { GuideRule } from "../../../shared/guides";

// 위반 탐지의 시각 질문: 규칙마다 프레임에 묻고 표를 모아 판정한다
const UNIFORM_FRAMES = 12;
const SCREEN_AD_QUESTION =
  'Is there on-screen text that discloses advertising or sponsorship (for example "광고", "협찬", "유료 광고", "#ad", "sponsored", "paid partnership")?';

type Kind = "required" | "forbidden";
type Question = { id: string; question: string; windowMs: number | null; kind: Kind };
export type VisualJudge = (ruleId: string, kind: Kind) => Verdict & { frameIds: string[] };

// 규칙 id → { 질문, 대상 구간, 종류 }
function visualQuestions(rules: GuideRule[], productName: string): Question[] {
  const questions: Question[] = [];
  for (const r of rules) {
    if (r.type === "required_scene") questions.push({ id: r.id, question: `Does this frame show: ${r.content}?`, windowMs: null, kind: "required" });
    if (r.type === "forbidden_scene") questions.push({ id: r.id, question: `Does this frame show: ${r.content}?`, windowMs: null, kind: "forbidden" });
    if (r.type === "ad_disclosure" && r.targets.includes("screen_text")) questions.push({ id: r.id, question: SCREEN_AD_QUESTION, windowMs: null, kind: "required" });
    const opening = r.type === "format" ? openingWindowMs(r.content) : null;
    if (opening != null)
      questions.push({ id: r.id, question: `Is the product${productName ? ` (${productName})` : ""} clearly visible in this frame?`, windowMs: opening, kind: "required" });
  }
  return questions;
}

async function collectVotes(ctx: Ctx, questions: Question[], votes: Map<string, FrameVote[]>, asked: Map<string, number>) {
  const { db, env, sub } = ctx;
  const all = await db.select({ id: frames.id, tMs: frames.tMs, imageKey: frames.imageKey }).from(frames).where(eq(frames.submissionId, sub.id));
  const windowMax = Math.max(-1, ...questions.map((q) => q.windowMs ?? -1));
  for (const f of sampleFrames(all, UNIFORM_FRAMES, windowMax >= 0 ? windowMax : null)) {
    const qs = questions.filter((q) => q.windowMs == null || f.tMs <= q.windowMs);
    if (!qs.length) continue;
    qs.forEach((q) => asked.set(q.id, asked.get(q.id)! + 1));
    const img = await env.FILES.get(f.imageKey);
    if (!img) continue;
    try {
      const answers = await judgeFrame(env, await img.arrayBuffer(), qs.map((q) => ({ id: q.id, question: q.question })));
      for (const a of answers) votes.get(a.id)?.push({ frameId: f.id, yes: a.yes, confidence: a.confidence });
    } catch (e) {
      // 형식 오류·호출 실패는 그 프레임만 빠진다. 전부 빠지면 해당 규칙이 판단 불가
      console.error("[pipeline:vision]", f.id, e);
    }
  }
}

export async function visualVotes(ctx: Ctx, rules: GuideRule[]): Promise<VisualJudge> {
  const questions = visualQuestions(rules, ctx.guide.product.name);
  const votes = new Map<string, FrameVote[]>(questions.map((q) => [q.id, []]));
  const asked = new Map<string, number>(questions.map((q) => [q.id, 0]));
  if (questions.length) await collectVotes(ctx, questions, votes, asked);
  return (id, kind) => aggregateVotes(kind, votes.get(id) ?? [], asked.get(id) ?? 0);
}
