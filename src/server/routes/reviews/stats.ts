import { Hono } from "hono";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { guideInfluencers, guidelineRules, guides, submissions, violationCandidates } from "../../db/schema";
import { workspaceCtx } from "../../middleware/auth";
import { addDecision, emptyStats, suggestRewrite, type RuleDecisionStats } from "./policy";

// 규칙별 기각 수·사유 분포와 문구 수정 제안 (338)

type RuleStat = RuleDecisionStats & { ruleId: string; ruleType: string; ruleContent: string; guideId: string; editUrl: string; suggest: boolean; notes: string[] };
const MAX_NOTES = 5;

function decisionsOf(db: Db, workspaceId: string, guideId: string | undefined) {
  const conds = [eq(guides.workspaceId, workspaceId), isNotNull(violationCandidates.decision)];
  if (guideId) conds.push(eq(guides.id, guideId));
  return db
    .select({ c: violationCandidates, guideId: guides.id })
    .from(violationCandidates)
    .innerJoin(submissions, eq(submissions.id, violationCandidates.submissionId))
    .innerJoin(guideInfluencers, eq(guideInfluencers.id, submissions.guideInfluencerId))
    .innerJoin(guides, eq(guides.id, guideInfluencers.guideId))
    .where(and(...conds))
    .orderBy(desc(violationCandidates.decidedAt));
}

// 공통 규정 묶음의 규칙이면 규정 화면, 가이드에만 있는 규칙이면 그 가이드 편집 화면
async function editUrls(db: Db, ruleIds: string[]) {
  const fromSet = new Set(ruleIds.length ? (await db.select({ id: guidelineRules.id }).from(guidelineRules).where(inArray(guidelineRules.id, ruleIds))).map((r) => r.id) : []);
  return (ruleId: string, guideId: string) => (fromSet.has(ruleId) ? "/dashboard/settings/guidelines" : `/dashboard/campaigns/${guideId}/edit`);
}

export const reviewStatsRoutes = new Hono<AppEnv>().get("/rule-stats", async (c) => {
  const { workspace } = workspaceCtx(c);
  const db = c.var.db;
  const rows = await decisionsOf(db, workspace.id, c.req.query("guideId"));
  const byRule = new Map<string, Omit<RuleStat, "editUrl" | "suggest">>();
  for (const { c: cand, guideId } of rows) {
    // 최근 판정이 먼저 오므로 처음 본 규칙 문구가 최신이다
    const st = byRule.get(cand.ruleId) ?? { ruleId: cand.ruleId, ruleType: cand.ruleType, ruleContent: cand.ruleContent, guideId, notes: [], ...emptyStats() };
    addDecision(st, cand.decision, cand.decisionReason);
    if (cand.decisionNote && st.notes.length < MAX_NOTES) st.notes.push(cand.decisionNote);
    byRule.set(cand.ruleId, st);
  }
  const urlOf = await editUrls(db, [...byRule.keys()]);
  const rules: RuleStat[] = [...byRule.values()]
    .map((st) => ({ ...st, editUrl: urlOf(st.ruleId, st.guideId), suggest: suggestRewrite(st) }))
    .sort((a, b) => b.rejected - a.rejected);
  return c.json({ rules });
});
