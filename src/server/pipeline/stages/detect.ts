import { and, asc, eq, inArray } from "drizzle-orm";
import { processingJobs, transcriptSegments, violationCandidates } from "../../db/schema";
import { newId, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { PROMPT_VERSION, modelName } from "../../lib/ai";
import { guideRules } from "../../lib/guides";
import { StageSkip, bumpAttempt, jobWhere, type Ctx } from "../context";
import type { Seg, Verdict } from "../rules";
import { visualVotes } from "./detect-visual";
import { judgeRule } from "./detect-rules";
import type { CandidateResult } from "../../../shared/review";
import type { GuideRule } from "../../../shared/guides";

// 7 위반 후보 탐지 (F-61)
const DETECT_ATTEMPTS = 2; // 1회 + 재시도 1회

type Draft = Verdict & { rule: GuideRule; frameIds: string[]; segmentIds: string[]; model: string };

async function loadSegs(ctx: Ctx): Promise<Seg[]> {
  const rows = await ctx.db.select().from(transcriptSegments).where(eq(transcriptSegments.submissionId, ctx.sub.id)).orderBy(asc(transcriptSegments.startMs));
  return rows.map((s) => ({ id: s.id, startMs: s.startMs, text: s.text, translatedText: s.translatedText, lang: s.lang }));
}

async function noSpeechVerdict(ctx: Ctx): Promise<Verdict> {
  const stt = await ctx.db.select({ status: processingJobs.status }).from(processingJobs).where(jobWhere(ctx.sub.id, "transcribe")).get();
  return { result: "undetermined", confidence: "low", reason: stt?.status === "failed" ? "전사에 실패해 대사를 확인하지 못했습니다." : "음성이 없어 대사를 확인하지 못했습니다." };
}

async function detectAll(ctx: Ctx): Promise<Draft[]> {
  const { db, env, sub, guide } = ctx;
  // 클린본에는 광고 표기 규칙을 적용하지 않는다 (F-61 예외)
  const rules = (await guideRules(db, guide)).filter((r) => r.enabled && !(sub.kind === "clean" && r.type === "ad_disclosure"));
  const segs = await loadSegs(ctx);
  const noSpeech = segs.length > 0 ? null : await noSpeechVerdict(ctx);
  const input = { env, sub, segs, noSpeech, visual: await visualVotes(ctx, rules), textModel: modelName(env, "text"), visionModel: modelName(env, "vision") };
  const drafts: Draft[] = [];
  for (const rule of rules) {
    const j = await judgeRule(rule, input);
    if (j) drafts.push({ ...j.verdict, rule, model: j.model, frameIds: j.frameIds ?? [], segmentIds: j.segmentIds ?? [] });
  }
  return drafts;
}

async function saveDrafts(ctx: Ctx, drafts: Draft[]) {
  const { db, sub } = ctx;
  const at = now();
  await db.delete(violationCandidates).where(eq(violationCandidates.submissionId, sub.id));
  if (drafts.length)
    await db.insert(violationCandidates).values(
      drafts.map((d) => ({
        id: newId(),
        submissionId: sub.id,
        ruleId: d.rule.id,
        ruleType: d.rule.type,
        ruleContent: d.rule.content,
        ruleVersion: d.rule.version ?? null,
        result: d.result,
        confidence: d.confidence,
        frameIds: d.frameIds,
        segmentIds: d.segmentIds,
        reason: d.reason,
        modelVersion: d.model,
        promptVersion: PROMPT_VERSION,
        createdAt: at,
      })),
    );
  const byResult: Partial<Record<CandidateResult, number>> = {};
  for (const d of drafts) byResult[d.result] = (byResult[d.result] ?? 0) + 1;
  await logEvent(db, ctx.workspaceId, "violation_candidates_generated", { count: (byResult.candidate ?? 0) + (byResult.needs_check ?? 0), by_result: byResult, model_version: modelName(ctx.env, "vision") });
}

export async function stageDetect(ctx: Ctx): Promise<string | null> {
  const { db, sub } = ctx;
  // 사람이 이미 판정한 후보가 있으면 덮어쓰지 않는다
  const decided = await db.select({ id: violationCandidates.id }).from(violationCandidates).where(and(eq(violationCandidates.submissionId, sub.id), inArray(violationCandidates.decision, ["adopted", "rejected", "held"]))).get();
  if (decided) throw new StageSkip("already_reviewed");

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= DETECT_ATTEMPTS; attempt++) {
    await bumpAttempt(ctx, "detect", attempt);
    try {
      await saveDrafts(ctx, await detectAll(ctx));
      return null;
    } catch (e) {
      lastError = e;
      console.error("[pipeline:detect]", sub.id, e);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("detect_failed");
}
