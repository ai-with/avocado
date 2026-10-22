import { Hono } from "hono";
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { approvals, contents, feedbackItems, frames, guideInfluencers, guides, influencers, processingJobs, reviewRounds, submissions, transcriptSegments, violationCandidates } from "../../db/schema";
import { guideLinks, guideRules } from "../../lib/guides";
import { workspaceCtx } from "../../middleware/auth";
import { approvalOf, fileUrl, isDelayed, loadSub, reviewState } from "./shared";

// 검수함 목록(/reviews)과 검수 화면 상세

const LIST_LIMIT = 300;
const HIDDEN_STATUSES: ("uploading" | "aborted")[] = ["uploading", "aborted"];

// 목록 행마다: 피드백을 보냈는지, 승인된 버전, 확인할 후보 수
async function listMarks(db: Db, subIds: string[], giIds: string[]) {
  const sent = new Set(subIds.length ? (await db.select({ id: reviewRounds.submissionId }).from(reviewRounds).where(inArray(reviewRounds.submissionId, subIds))).map((r) => r.id) : []);
  const approved = new Map(giIds.length ? (await db.select().from(approvals).where(inArray(approvals.guideInfluencerId, giIds))).map((a) => [a.guideInfluencerId, a.submissionId]) : []);
  const cands = subIds.length ? await db.select({ sub: violationCandidates.submissionId, result: violationCandidates.result }).from(violationCandidates).where(inArray(violationCandidates.submissionId, subIds)) : [];
  const candN = new Map<string, number>();
  for (const x of cands) if (x.result === "candidate" || x.result === "needs_check") candN.set(x.sub, (candN.get(x.sub) ?? 0) + 1);
  return { sent, approved, candN };
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

// 모든 버전의 피드백 항목. 프레임 이미지 주소를 붙인다
async function feedbackOf(db: Db, versionIds: string[]) {
  const items = await db.select().from(feedbackItems).where(inArray(feedbackItems.submissionId, versionIds)).orderBy(asc(feedbackItems.n), asc(feedbackItems.tMs), asc(feedbackItems.createdAt));
  const frameOf = new Map((await db.select({ id: frames.id, key: frames.imageKey }).from(frames).where(inArray(frames.submissionId, versionIds))).map((f) => [f.id, fileUrl(f.key)]));
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

export const reviewListRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const state = c.req.query("state");
    const rows = await listRows(db, workspace.id, c.req.query());
    const { sent, approved, candN } = await listMarks(db, rows.map((r) => r.sub.id), [...new Set(rows.map((r) => r.gi.id))]);
    const list = rows
      .map((r) => ({
        id: r.sub.id,
        version: r.sub.version,
        status: r.sub.status,
        state: reviewState(r.sub, approved.get(r.gi.id) ?? null, sent.has(r.sub.id)),
        delayed: isDelayed(r.sub),
        uploadedAt: r.sub.uploadedAt,
        driveUrl: r.sub.driveUrl,
        guide: r.guide,
        influencer: r.influencer,
        candidates: candN.get(r.sub.id) ?? 0,
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
      content: await db.select().from(contents).where(eq(contents.guideInfluencerId, gi.id)).get(),
      canApprove: role === "owner" || role === "approver",
      canEdit: role === "owner" || role === "editor",
    });
  });
