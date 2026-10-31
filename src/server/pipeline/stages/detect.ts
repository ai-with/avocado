import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { processingJobs, transcriptSegments, violationCandidates } from "../../db/schema";
import { newId, now } from "../../lib/ids";
import { chunkRows } from "../../lib/chunks";
import { PROMPT_VERSION, modelName } from "../../lib/ai";
import { reviewRules } from "../../lib/guides";
import { StageSkip, bumpAttempt, jobWhere, type Ctx } from "../context";
import type { Seg, Verdict } from "../rules";
import { visualVotes } from "./detect-visual";
import { judgeRule } from "./detect-rules";
import type { CandidateResult } from "../../../shared/review";
import type { GuideRule } from "../../../shared/guides";
import { ruleSource } from "../../../shared/brand-terms";
import { MediaWithdrawn } from "../../lib/media-purge";
import { analysisWrite, assertCurrentAnalysis, processingEvent, StaleAnalysis } from "../analysis";

// 7 위반 후보 탐지 (F-61)
const DETECT_ATTEMPTS = 2; // 1회 + 재시도 1회
const CANDIDATE_COLUMNS = 20; // violation_candidates 컬럼 수(여유 포함). insert 한 문장의 행 수를 정한다

type Draft = Verdict & { rule: GuideRule; frameIds: string[]; segmentIds: string[]; model: string };

async function loadSegs(ctx: Ctx): Promise<Seg[]> {
  const rows = await ctx.db.select().from(transcriptSegments).where(eq(transcriptSegments.submissionId, ctx.sub.id)).orderBy(asc(transcriptSegments.startMs));
  return rows.map((s) => ({ id: s.id, startMs: s.startMs, text: s.text, translatedText: s.translatedText, lang: s.lang }));
}

async function noSpeechVerdict(ctx: Ctx): Promise<Verdict> {
  const stt = await ctx.db.select({ status: processingJobs.status, error: processingJobs.error }).from(processingJobs).where(jobWhere(ctx.sub.id, "transcribe")).get();
  const reason = stt?.status === "failed" ? "전사에 실패해 대사를 확인하지 못했어요." : stt?.error === "no_audio_track" ? "오디오 트랙이 없어 대사를 확인하지 못했어요." : stt?.error === "no_speech" ? "오디오에서 대사를 찾지 못했어요." : "오디오를 확인하지 못해 대사를 판단할 수 없어요.";
  return { result: "undetermined", confidence: "low", reason };
}

// 법규 기본 목록은 수십 개라 준수·판단 불가까지 남기면 후보 목록이 묻힌다. 걸린 것만 남긴다 (TASK-079)
const keepDraft = (rule: GuideRule, v: Verdict) => ruleSource(rule.id) !== "legal" || v.result === "candidate";

async function detectAll(ctx: Ctx): Promise<Draft[]> {
  const { db, env, sub, guide } = ctx;
  // 클린본에는 광고 표기 규칙을 적용하지 않는다 (F-61 예외)
  const rules = (await reviewRules(db, guide)).filter((r) => r.enabled && !(sub.kind === "clean" && r.type === "ad_disclosure"));
  const segs = await loadSegs(ctx);
  const noSpeech = segs.length > 0 ? null : await noSpeechVerdict(ctx);
  const input = { env, sub, segs, noSpeech, visual: await visualVotes(ctx, rules), textModel: modelName(env, "text"), visionModel: modelName(env, "vision") };
  const drafts: Draft[] = [];
  for (const rule of rules) {
    // With no transcript judgeRule uses only already-collected visual votes and
    // local rules. The atomic save below guards that local work's generation.
    if (segs.length) await assertCurrentAnalysis(ctx);
    const j = await judgeRule(rule, input);
    if (j && keepDraft(rule, j.verdict)) drafts.push({ ...j.verdict, rule, model: j.model, frameIds: j.frameIds ?? [], segmentIds: j.segmentIds ?? [] });
  }
  return drafts;
}

async function saveDrafts(ctx: Ctx, drafts: Draft[]) {
  const { db, sub } = ctx;
  const at = now();
  const rows = drafts.map((d) => ({
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
  }));
  // 사전 규칙이 붙으면 후보가 수십 개라 D1 바인딩 한도(100)에 맞춰 나눠 넣는다. 지우기와 넣기는 한 batch 로 묶는다
  const deleteOld = db.delete(violationCandidates).where(eq(violationCandidates.submissionId, sub.id));
  const inserts = chunkRows(rows, CANDIDATE_COLUMNS).map((part) => db.insert(violationCandidates).values(part));
  const byResult: Partial<Record<CandidateResult, number>> = {};
  for (const d of drafts) byResult[d.result] = (byResult[d.result] ?? 0) + 1;
  try {
    await analysisWrite(ctx, [sql`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM violation_candidates WHERE submission_id=${sub.id} AND decision IS NOT NULL)
      THEN 1 ELSE json('already_reviewed') END`, deleteOld, ...inserts,
      processingEvent(ctx, "violation_candidates_generated", { count: (byResult.candidate ?? 0) + (byResult.needs_check ?? 0), by_result: byResult, model_version: modelName(ctx.env, "vision") })]);
  } catch (error) {
    if (await db.select({ id: violationCandidates.id }).from(violationCandidates).where(and(eq(violationCandidates.submissionId, sub.id), inArray(violationCandidates.decision, ["adopted", "rejected", "held"]))).get()) throw new StageSkip("already_reviewed");
    throw error;
  }
}

export async function stageDetect(ctx: Ctx): Promise<string | null> {
  const { db, sub } = ctx;
  await assertCurrentAnalysis(ctx);
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
      if (e instanceof MediaWithdrawn || e instanceof StaleAnalysis || e instanceof StageSkip) throw e;
      lastError = e;
      console.error("[pipeline:detect]", sub.id, e);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("detect_failed");
}
