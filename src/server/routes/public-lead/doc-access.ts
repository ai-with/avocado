import type { Context } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { documentViews, documents, forms, shortLinks } from "../../db/schema";
import { ApiError } from "../../lib/errors";
import { now } from "../../lib/ids";
import { enqueueAutomations } from "../../lib/messaging";
import { signUnlock, unlockSecret, verifyUnlock } from "../../lib/doc-unlock";
import { normalizeGate } from "../../../shared/doc-gate";

// 공개 자료 열람 권한: 링크로 자료 찾기, 열람 세션, 게이트 통과(서명된 열람 토큰) 확인

export type View = typeof documentViews.$inferSelect;
export type DocAccess = Awaited<ReturnType<typeof docForSlug>>;
export type Doc = DocAccess["doc"];

// 링크 slug 로 열람할 자료를 찾는다. 폼 링크면 제출 후 연결 자료(afterSubmit)를 연다
export async function docForSlug(db: Db, slug: string) {
  const link = await db.select().from(shortLinks).where(eq(shortLinks.slug, slug)).get();
  if (!link || link.deletedAt) throw new ApiError(410, "link_expired", "만료된 링크예요.");
  let docId = link.destinationType === "document" ? link.destinationId : null;
  let viaForm = false;
  if (link.destinationType === "form" && link.destinationId) {
    const form = await db.select({ afterSubmit: forms.afterSubmit }).from(forms).where(eq(forms.id, link.destinationId)).get();
    if (form?.afterSubmit.type === "document") (docId = form.afterSubmit.documentId), (viaForm = true);
  }
  const row = docId ? await db.select().from(documents).where(and(eq(documents.id, docId), isNull(documents.deletedAt))).get() : undefined;
  if (!row) throw new ApiError(404, "document_not_found", "자료를 찾을 수 없어요.");
  const gate = normalizeGate(row.gate, row.pages);
  // PDF 파일과 주소 스냅샷은 게이트 앞부분만 잘라 줄 수 없다. 통째로 주면 게이트를 우회할 수 있으니
  // 끝(100%)이 아닌 게이트는 열자마자 묻고, 통과(열람 토큰) 뒤에만 원본을 준다
  if (row.sourceType !== "editor" && gate.scrollPct < 100) gate.scrollPct = 0;
  return { link, doc: { ...row, gate }, viaForm };
}

export async function viewFor(db: Db, viewToken: string, documentId: string): Promise<View> {
  const view = await db.select().from(documentViews).where(and(eq(documentViews.id, viewToken), eq(documentViews.documentId, documentId))).get();
  if (!view) throw new ApiError(403, "invalid_view", "자료를 다시 열어 주세요.");
  return view;
}

export const gateRequired = (position: string, viaForm: boolean) => !viaForm && position !== "none";

// 게이트를 통과했는지. 폼으로 연 자료는 제출로 리드가 붙은 열람 세션, 게이트 자료는 열람 토큰(t)으로 본다
export async function gatePassed(c: Context<AppEnv>, s: DocAccess, view: View): Promise<boolean> {
  if (s.viaForm) return !!view.leadId;
  if (!gateRequired(s.doc.gate.position, false)) return true;
  return !!(await verifyUnlock(unlockSecret(c.env), c.req.query("t"), s.doc.id, now()));
}

// 원본(PDF·스냅샷)을 받을 수 있는 열람 세션인지 확인한다. 끝(100%) 게이트는 통과 전에도 전부 보여 준다
export async function openedDoc(c: Context<AppEnv>): Promise<Doc> {
  const s = await docForSlug(c.var.db, c.req.param("slug") ?? "");
  const view = await viewFor(c.var.db, c.req.query("v") ?? "", s.doc.id);
  if (s.viaForm && !view.leadId) throw new ApiError(403, "form_required", "신청서를 내면 볼 수 있어요.");
  if (s.doc.gate.scrollPct < 100 && !(await gatePassed(c, s, view))) throw new ApiError(403, "gate_required", "이메일을 입력하면 바로 볼 수 있어요.");
  return s.doc;
}

// 게이트 통과 처리: 자동화 예약 후 열람 토큰을 준다(인증이 필요한 자료는 인증 링크를 누른 뒤 부른다)
export async function passGate(c: Context<AppEnv>, doc: Doc, leadId: string, guideId: string | null): Promise<string> {
  await enqueueAutomations(c.var.db, { workspaceId: doc.workspaceId, trigger: "gate_passed", leadId, ref: { id: doc.id, guideId } });
  return signUnlock(unlockSecret(c.env), doc.id, leadId, now());
}
