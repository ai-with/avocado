import { and, desc, eq, ne } from "drizzle-orm";
import type { Db } from "../../db";
import { reviewRounds, submissions, supersededVersions } from "../../db/schema";
import { groupVersions } from "../../../shared/versions";
import { approvalOf } from "../reviews/shared";

// 업로드·피드백 공개 화면이 함께 쓰는 버전별 묶음 (TASK-074). 버전 = 완성본 기준
export async function versionHistory(db: Db, giId: string) {
  const subs = await db
    .select({ id: submissions.id, version: submissions.version, kind: submissions.kind, status: submissions.status, uploadedAt: submissions.uploadedAt, createdAt: submissions.createdAt })
    .from(submissions)
    .where(and(eq(submissions.guideInfluencerId, giId), ne(submissions.status, "aborted")));
  const approval = await approvalOf(db, giId);
  const superseded = await db.select({ id: supersededVersions.submissionId }).from(supersededVersions).where(eq(supersededVersions.guideInfluencerId, giId));
  const rounds = await db.select().from(reviewRounds).where(eq(reviewRounds.guideInfluencerId, giId)).orderBy(desc(reviewRounds.n));
  const groups = groupVersions(subs, { approvedId: approval?.submissionId ?? null, supersededIds: new Set(superseded.map((s) => s.id)), sentIds: new Set(rounds.map((r) => r.submissionId)) });
  return { groups, rounds, approval, versionOf: new Map(subs.map((s) => [s.id, s.version])) };
}
