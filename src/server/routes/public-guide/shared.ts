import type { Context } from "hono";
import { and, asc, desc, eq, max, ne } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { consents, guideInfluencers, guides, submissions, uploadParts } from "../../db/schema";
import { ApiError } from "../../lib/errors";
import { sendEmail } from "../../lib/email";
import { escapeHtml } from "../../lib/html";
import { memberEmails } from "../../lib/members";
import { activeConsent } from "../../lib/guide-status";
import { findByToken, guideRules, linkNotFound } from "../../lib/guides";
import { checklistFromRules } from "../../../shared/guides";

// 인플루언서용 공개 API 공용. 로그인 없이 토큰으로만 접근한다 (4-1)

type Gi = typeof guideInfluencers.$inferSelect;
type Guide = typeof guides.$inferSelect;
type PublicColumn = "guideToken" | "uploadToken";

// 발행된 가이드의 링크만 열린다
export async function byToken(db: Db, column: PublicColumn, token: string) {
  const row = await findByToken(db, column, token);
  if (row && row.guide.status !== "published") throw new ApiError(404, "guide_not_published", "아직 공개되지 않은 가이드입니다.");
  return row;
}

export async function requireByToken(db: Db, column: PublicColumn, token: string) {
  const row = await byToken(db, column, token);
  if (!row) throw linkNotFound();
  return row;
}

export function currentConsent(db: Db, giId: string) {
  return db.select().from(consents).where(activeConsent(giId)).orderBy(desc(consents.agreedAt)).get();
}

// 업로드 계열은 철회되지 않은 동의가 있어야 열린다 (F-58)
export async function uploadCtx(c: Context<AppEnv>) {
  const row = await requireByToken(c.var.db, "uploadToken", c.req.param("token") ?? "");
  const consent = await currentConsent(c.var.db, row.gi.id);
  if (!consent) throw new ApiError(403, "consent_required", "동의를 먼저 완료해 주세요.");
  return row;
}

export async function findSubmission(db: Db, gi: Gi, id: string) {
  const s = await db.select().from(submissions).where(and(eq(submissions.id, id), eq(submissions.guideInfluencerId, gi.id))).get();
  if (!s) throw new ApiError(404, "submission_not_found", "업로드를 찾을 수 없습니다.");
  return s;
}

export async function notifyOwners(env: Env, db: Db, workspaceId: string, subject: string, text: string) {
  const owners = await memberEmails(db, workspaceId, ["owner"]);
  for (const o of owners) await sendEmail(env, { to: o.email, subject, text, html: `<p>${escapeHtml(text)}</p>` });
}

export async function publicGuideBody(db: Db, guide: Guide, workspaceName: string) {
  const rules = (await guideRules(db, guide)).filter((r) => r.enabled);
  return {
    brandName: workspaceName,
    name: guide.name,
    product: guide.product,
    purpose: guide.purpose,
    lengthS: guide.lengthS,
    deadlineAt: guide.deadlineAt,
    deliverables: guide.deliverables,
    secondaryUseScope: guide.secondaryUseScope,
    videoGuide: guide.videoGuide,
    rules: rules.map(({ type, content, severity }) => ({ type, content, severity })),
    checklist: guide.videoGuide?.checklist.length ? guide.videoGuide.checklist : checklistFromRules(rules),
  };
}

// 같은 인플루언서의 새 완성본은 새 버전. 클린본은 최신 완성본 버전에 붙는다
export async function nextVersion(db: Db, giId: string, kind: "final" | "clean") {
  const row = await db
    .select({ v: max(submissions.version) })
    .from(submissions)
    .where(and(eq(submissions.guideInfluencerId, giId), eq(submissions.kind, "final"), ne(submissions.status, "uploading"), ne(submissions.status, "aborted")))
    .get();
  const latest = row?.v ?? 0;
  return kind === "final" ? latest + 1 : Math.max(latest, 1);
}

export function partsOf(db: Db, submissionId: string) {
  return db.select({ partNumber: uploadParts.partNumber, etag: uploadParts.etag, size: uploadParts.size }).from(uploadParts).where(eq(uploadParts.submissionId, submissionId)).orderBy(asc(uploadParts.partNumber));
}

// 업로드를 취소 상태로 두고 기록한 part 를 지운다
export async function markAborted(db: Db, submissionId: string) {
  await db.batch([db.update(submissions).set({ status: "aborted" }).where(eq(submissions.id, submissionId)), db.delete(uploadParts).where(eq(uploadParts.submissionId, submissionId))]);
}
