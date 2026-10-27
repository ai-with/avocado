import { Hono } from "hono";
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { approvals, contents, feedbackItems, frames, guideInfluencers, guides, influencers, processingJobs, reviewRounds, submissions, supersededVersions, transcriptSegments, violationCandidates } from "../../db/schema";
import { guideLinks, guideRules } from "../../lib/guides";
import { workspaceCtx } from "../../middleware/auth";
import { approvalOf, approvedRefOf, fileUrl, isDelayed, isSuperseded, loadSub } from "./shared";
import { approveCheck, isLocked, reviewState, type ApprovedRef } from "./policy";
import { conflictsOf } from "./conflicts";
import { selectInChunks } from "../../lib/chunks";

// 검수함 목록(/reviews)과 검수 화면 상세

const LIST_LIMIT = 300;
const HIDDEN_STATUSES: ("uploading" | "aborted")[] = ["uploading", "aborted"];

// 목록 행마다: 피드백을 보냈는지, 승인된 버전, 기존 승인 유지로 닫은 버전, 확인할 후보 수, 판단 엇갈림
async function listMarks(db: Db, subIds: string[], giIds: string[]) {
  const sent = new Set((await selectInChunks(subIds, (part) => db.select({ id: reviewRounds.submissionId }).from(reviewRounds).where(inArray(reviewRounds.submissionId, part)))).map((r) => r.id));
  const approvedRows = await selectInChunks(giIds, (part) =>
    db.select({ gi: approvals.guideInfluencerId, submissionId: approvals.submissionId, version: submissions.version }).from(approvals).innerJoin(submissions, eq(submissions.id, approvals.submissionId)).where(inArray(approvals.guideInfluencerId, part)),
  );
  const approved = new Map<string, ApprovedRef>(approvedRows.map((a) => [a.gi, { submissionId: a.submissionId, version: a.version }]));
  const superseded = new Set((await selectInChunks(subIds, (part) => db.select({ id: supersededVersions.submissionId }).from(supersededVersions).where(inArray(supersededVersions.submissionId, part)))).map((r) => r.id));
  const cands = await selectInChunks(subIds, (part) => db.select({ sub: violationCandidates.submissionId, result: violationCandidates.result }).from(violationCandidates).where(inArray(violationCandidates.submissionId, part)));
  const candN = new Map<string, number>();
  for (const x of cands) if (x.result === "candidate" || x.result === "needs_check") candN.set(x.sub, (candN.get(x.sub) ?? 0) + 1);
  return { sent, approved, superseded, candN, conflicts: await conflictsOf(db, subIds) };
}

function listRows(db: Db, workspaceId: string, q: Record<string, string>) {
  const conds = [eq(guides.workspaceId, workspaceId), eq(submissions.kind, "final"), notInArray(submissions.status, HIDDEN_STATUSES)];
  if (q.guideId) conds.push(eq(guides.id, q.guideId));
  if (q.influencerId) conds.push(eq(influencers.id, q.influencerId));
  return db
    .select({ sub: submissions, gi: guideInfluencers, guide: { id: guides.id, name: guides.name }, influencer: { id: influencers.id, displayName: influencers.displayName, igHandle: influencers.igHandle, lang: influencers.lang } })
    .from(submissions)
    .innerJoin(guideInfluencers, eq(guideInfluencers.id, submissions.guideInfluencerId))
    .innerJoin(guides, eq(guides.id, guideInfluencers.guideId))
    .innerJoin(influencers, eq(influencers.id, guideInfluencers.influencerId))
    .where(and(...conds))
    .orderBy(desc(submissions.createdAt))
    .limit(LIST_LIMIT);
}

function versionsOf(db: Db, giId: string) {
  return db
    .select({ id: submissions.id, version: submissions.version, kind: submissions.kind, status: submissions.status, uploadedAt: submissions.uploadedAt, originalKey: submissions.originalKey, fileName: submissions.fileName, driveUrl: submissions.driveUrl, note: submissions.note })
    .from(submissions)
    .where(and(eq(submissions.guideInfluencerId, giId), notInArray(submissions.status, HIDDEN_STATUSES)))
    .orderBy(asc(submissions.version), asc(submissions.createdAt));
}

// SQLite 오름차순처럼 null을 앞에 둔다 (묶음별 조회 뒤 다시 정렬할 때 쓴다)
const byNullsFirst = (a: number | null, b: number | null) => (a ?? -Infinity) - (b ?? -Infinity) || 0;

// 모든 버전의 피드백 항목. 프레임 이미지 주소를 붙인다
async function feedbackOf(db: Db, versionIds: string[]) {
  const items = (await selectInChunks(versionIds, (part) => db.select().from(feedbackItems).where(inArray(feedbackItems.submissionId, part)))).sort((a, b) => byNullsFirst(a.n, b.n) || byNullsFirst(a.tMs, b.tMs) || byNullsFirst(a.createdAt, b.createdAt));
  const frameOf = new Map((await selectInChunks(versionIds, (part) => db.select({ id: frames.id, key: frames.imageKey }).from(frames).where(inArray(frames.submissionId, part)))).map((f) => [f.id, fileUrl(f.key)]));
  return items.map((i) => ({ ...i, frameUrl: i.frameId ? (frameOf.get(i.frameId) ?? null) : null }));
}

// 처리 결과: 작업 단계, 프레임, 전사, 위반 후보
async function analysisOf(db: Db, subId: string) {
  const jobs = await db.select().from(processingJobs).where(eq(processingJobs.submissionId, subId));
  const frameRows = await db.select().from(frames).where(eq(frames.submissionId, subId)).orderBy(asc(frames.tMs));
  const segments = await db.select().from(transcriptSegments).where(eq(transcriptSegments.submissionId, subId)).orderBy(asc(transcriptSegments.startMs));
  const candidates = await db.select().from(violationCandidates).where(eq(violationCandidates.submissionId, subId)).orderBy(asc(violationCandidates.createdAt));
  return { jobs, frames: frameRows.map((f) => ({ id: f.id, tMs: f.tMs, source: f.source, url: fileUrl(f.imageKey) })), segments, candidates };
}

// 승인 뒤 새 버전 상태와 승인된 버전 번호 (340)
async function afterApprovalOf(db: Db, sub: typeof submissions.$inferSelect, giId: string) {
  const approved = await approvedRefOf(db, giId);
  const superseded = await isSuperseded(db, sub.id);
  return { approvedVersion: approved?.version ?? null, afterApproval: approveCheck(sub, approved, superseded) === "move", superseded, locked: isLocked(sub, approved, superseded) };
}

export const reviewListRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const state = c.req.query("state");
    const rows = await listRows(db, workspace.id, c.req.query());
    const { sent, approved, superseded, candN, conflicts } = await listMarks(db, rows.map((r) => r.sub.id), [...new Set(rows.map((r) => r.gi.id))]);
    const list = rows
      .map((r) => ({
        id: r.sub.id,
        version: r.sub.version,
        status: r.sub.status,
        state: reviewState(r.sub, approved.get(r.gi.id) ?? null, sent.has(r.sub.id), superseded.has(r.sub.id)),
        delayed: isDelayed(r.sub),
        uploadedAt: r.sub.uploadedAt,
        driveUrl: r.sub.driveUrl,
        driveAccess: r.sub.driveAccess,
        guide: r.guide,
        influencer: r.influencer,
        candidates: candN.get(r.sub.id) ?? 0,
        conflicts: conflicts.get(r.sub.id)?.ids.length ?? 0,
      }))
      .filter((r) => !state || r.state === state);
    return c.json({ rows: list });
  })
  .get("/:id", async (c) => {
    const db = c.var.db;
    const { sub, gi, guide, influencer } = await loadSub(c, c.req.param("id"));
    const { role } = workspaceCtx(c);
    const versions = await versionsOf(db, gi.id);
    const clean = versions.find((v) => v.kind === "clean" && v.version === sub.version && v.originalKey);
    const analysis = await analysisOf(db, sub.id);
    const rounds = await db.select().from(reviewRounds).where(eq(reviewRounds.guideInfluencerId, gi.id)).orderBy(asc(reviewRounds.n));
    const items = await feedbackOf(db, versions.map((v) => v.id));
    const versionOf = new Map(versions.map((v) => [v.id, v.version]));
    return c.json({
      submission: { ...sub, videoUrl: sub.originalKey ? fileUrl(sub.originalKey) : null, delayed: isDelayed(sub) },
      cleanUrl: clean?.originalKey ? fileUrl(clean.originalKey) : null,
      guide: { id: guide.id, name: guide.name },
      influencer: { id: influencer.id, displayName: influencer.displayName, igHandle: influencer.igHandle, lang: influencer.lang },
      giId: gi.id,
      feedbackUrl: guideLinks(c.env, gi).feedback,
      versions: versions.filter((v) => v.kind === "final").map(({ originalKey: _k, ...v }) => v),
      ...analysis,
      rules: (await guideRules(db, guide)).filter((r) => r.enabled),
      drafts: items.filter((i) => i.submissionId === sub.id && !i.roundId),
      rounds: rounds.map((r) => ({ ...r, version: versionOf.get(r.submissionId) ?? null, items: items.filter((i) => i.roundId === r.id) })),
      approval: await approvalOf(db, gi.id),
      ...(await afterApprovalOf(db, sub, gi.id)),
      conflicts: (await conflictsOf(db, [sub.id])).get(sub.id) ?? { ids: [], times: [] },
      content: await db.select().from(contents).where(eq(contents.guideInfluencerId, gi.id)).get(),
      canApprove: role === "owner" || role === "approver",
      canEdit: role === "owner" || role === "editor",
    });
  });
