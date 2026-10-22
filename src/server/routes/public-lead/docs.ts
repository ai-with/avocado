import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { documentPageViews, documentViews, documents, forms, shortLinks } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newToken, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { requireObject } from "../../lib/http";
import { upsertLead } from "../../lib/leads";
import { enqueueAutomations } from "../../lib/messaging";
import { snapshotResponse } from "../../lib/snapshot";
import { isBlockedEmail, isFreeEmail, type DocumentGate } from "../../../shared/leads";
import { normalizeGate } from "../../../shared/doc-gate";
import { sanitizeHtml } from "../../../shared/sanitize";
import { NOINDEX, brandName, consentFields, contactFields, isMember, visitorId } from "./shared";

// 공개 자료 (/d/:slug): 열람 세션, 리드 게이트, 열람 행동

type View = typeof documentViews.$inferSelect;
type Doc = Awaited<ReturnType<typeof docForSlug>>["doc"];
// 한 배치에서 한 페이지에 10분 넘게 쌓이지 않게 자른다
const MAX_DWELL_PER_BATCH_MS = 600_000;

const gateBody = z.object({ viewToken: z.string(), ...contactFields, answers: z.record(z.string(), z.string().max(2000)).default({}), ...consentFields });
const eventsBody = z.object({
  viewToken: z.string(),
  pages: z.array(z.object({ page: z.number().int().min(1), dwellMs: z.number().int().min(0) })).max(200),
  maxPage: z.number().int().min(0),
  maxScrollPct: z.number().min(0).max(100),
  completed: z.boolean(),
});

// 링크 slug 로 열람할 자료를 찾는다. 폼 링크면 제출 후 연결 자료(afterSubmit)를 연다
async function docForSlug(db: Db, slug: string) {
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
  // 주소를 불러오지 못한 자료는 본문을 보여 줄 수 없으니 열자마자 묻고 새 창 열기만 준다
  if (row.sourceType === "url" && !row.fetchedHtmlKey) gate.scrollPct = 0;
  return { link, doc: { ...row, gate }, viaForm };
}

async function viewFor(db: Db, viewToken: string, documentId: string) {
  const view = await db.select().from(documentViews).where(and(eq(documentViews.id, viewToken), eq(documentViews.documentId, documentId))).get();
  if (!view) throw new ApiError(403, "invalid_view", "자료를 다시 열어 주세요.");
  return view;
}

const gateRequired = (position: string, viaForm: boolean) => !viaForm && position !== "none";
// 본문을 내려줘도 되는지. 0% 게이트는 통과 전에 본문을 아예 주지 않고, 그보다 뒤 게이트는 화면에서 스크롤을 막는다
// ponytail: 0% 초과 게이트의 본문 잠금은 클라이언트 몫이라 개발자 도구로 우회할 수 있다. 막아야 하면 비율 이후 본문을 게이트 통과 뒤에 따로 받게 바꾼다
const contentOpen = (g: DocumentGate, viaForm: boolean, leadId: string | null) => !gateRequired(g.position, viaForm) || !!leadId || g.scrollPct > 0;

// 원본(PDF·스냅샷)을 받을 수 있는 열람 세션인지 확인한다
async function openedView(c: Context<AppEnv>) {
  const db = c.var.db;
  const { doc, viaForm } = await docForSlug(db, c.req.param("slug") ?? "");
  const view = await viewFor(db, c.req.query("v") ?? "", doc.id);
  if (!contentOpen(doc.gate, viaForm, view.leadId)) throw new ApiError(403, "gate_required", "이메일을 입력하면 바로 볼 수 있어요.");
  if (viaForm && !view.leadId) throw new ApiError(403, "form_required", "신청서를 내면 볼 수 있어요.");
  return doc;
}

// 이어 보기(v) 또는 새 열람 세션. 같은 방문자가 이 자료의 게이트를 이미 통과했으면 다시 묻지 않는다
async function startView(c: Context<AppEnv>, s: Awaited<ReturnType<typeof docForSlug>>): Promise<View> {
  const db = c.var.db;
  const { link, doc, viaForm } = s;
  const vid = visitorId(c);
  const member = await isMember(c, doc.workspaceId);
  const v = c.req.query("v");
  const prevView = v ? await db.select().from(documentViews).where(and(eq(documentViews.id, v), eq(documentViews.documentId, doc.id))).get() : undefined;
  if (viaForm && !prevView?.leadId) throw new ApiError(403, "form_required", "신청서를 내면 볼 수 있어요.");
  if (prevView) return prevView;
  const prev = await db.select({ leadId: documentViews.leadId }).from(documentViews).where(and(eq(documentViews.documentId, doc.id), eq(documentViews.sessionId, vid), isNotNull(documentViews.leadId))).get();
  const row = { id: newToken(18), documentId: doc.id, linkId: link.id, sessionId: vid, leadId: prev?.leadId ?? null, startedAt: now(), lastSeenAt: now(), isMember: member };
  await db.insert(documentViews).values(row);
  await logEvent(db, doc.workspaceId, "document_viewed", { link_id: link.id, channel: link.channelKey, is_member: member });
  if (gateRequired(doc.gate.position, viaForm) && !row.leadId) await logEvent(db, doc.workspaceId, "lead_form_viewed", { link_id: link.id, channel: link.channelKey });
  return { ...row, completed: false, maxPage: 0, maxScrollPct: 0 };
}

function gateErrors(g: DocumentGate, body: z.infer<typeof gateBody>) {
  const fields: Record<string, string> = {};
  if (g.fields.name && !body.name) fields.name = "이름을 넣어 주세요.";
  if (g.fields.company && !body.company) fields.company = "소속을 넣어 주세요.";
  if (g.fields.phone && !body.phone) fields.phone = "전화번호를 넣어 주세요.";
  for (const q of g.questions) if (q.required && !body.answers[q.id]?.trim()) fields[`answers.${q.id}`] = "답을 넣어 주세요.";
  if (g.companyEmailOnly && isFreeEmail(body.email)) fields.email = "회사 이메일로 입력해 주세요.";
  if (Object.keys(fields).length) throw new ApiError(400, "validation_error", "입력값을 확인해 주세요.", fields);
  if (isBlockedEmail(body.email, g.blockedEmails)) throw new ApiError(403, "email_blocked", "이 이메일로는 열람할 수 없어요.");
}

// 질문 id 로 받은 답을 질문 문구 기준으로 바꿔 리드에 남긴다
function labeledAnswers(g: DocumentGate, answers: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const q of g.questions) if (answers[q.id]) out[q.label] = answers[q.id]!;
  return out;
}

async function recordPages(db: Db, doc: Doc, view: View, pages: z.infer<typeof eventsBody>["pages"]) {
  for (const p of pages) {
    if (p.page > doc.pages || p.dwellMs === 0) continue;
    const dwell = Math.min(p.dwellMs, MAX_DWELL_PER_BATCH_MS);
    await db
      .insert(documentPageViews)
      .values({ viewId: view.id, page: p.page, dwellMs: dwell })
      .onConflictDoUpdate({ target: [documentPageViews.viewId, documentPageViews.page], set: { dwellMs: sql`${documentPageViews.dwellMs} + ${dwell}` } });
    if (!view.isMember) await logEvent(db, doc.workspaceId, "document_page_viewed", { page: p.page, dwell_ms: dwell });
  }
}

export const publicDocRoutes = new Hono<AppEnv>()
  // 공개 자료: 메타, 게이트 설정, 열람 세션 발급
  .get("/doc/:slug", async (c) => {
    const db = c.var.db;
    const s = await docForSlug(db, c.req.param("slug"));
    const { doc, viaForm } = s;
    if (doc.gate.expiresAt && doc.gate.expiresAt < now()) throw new ApiError(410, "document_expired", "열람 기간이 끝난 자료예요.");
    const view = await startView(c, s);
    const g = doc.gate;
    const open = contentOpen(g, viaForm, view.leadId);
    const body = {
      viewToken: view.id,
      title: doc.title,
      sourceType: doc.sourceType,
      pages: doc.pages,
      allowDownload: doc.allowDownload,
      brandName: await brandName(db, doc.workspaceId),
      gate: { position: viaForm ? "none" : g.position, scrollPct: g.scrollPct, fields: g.fields, questions: g.questions, companyEmailOnly: g.companyEmailOnly },
      gatePassed: !gateRequired(g.position, viaForm) || !!view.leadId,
      html: open && doc.sourceType === "editor" ? sanitizeHtml(doc.contentHtml ?? "") : null,
      hasSnapshot: !!doc.fetchedHtmlKey,
      sourceUrl: open && doc.sourceType === "url" ? doc.sourceUrl : null,
    };
    return c.json(body, 200, NOINDEX);
  })
  .post("/doc/:slug/gate", async (c) => {
    const db = c.var.db;
    const { link, doc } = await docForSlug(db, c.req.param("slug"));
    const body = parse(gateBody, await c.req.json());
    const view = await viewFor(db, body.viewToken, doc.id);
    gateErrors(doc.gate, body);
    // TODO: g.requireVerify 면 인증 메일 링크를 눌러야 열리게 한다 (지금은 설정만 저장)
    // 키워드 DM 링크로 들어온 리드는 게이트를 거쳐도 출처를 DM으로 센다
    const leadSourceType = link.channelKey === "ig_comment_dm" ? "keyword_dm" : "gate";
    const { leadId } = await upsertLead(db, {
      workspaceId: doc.workspaceId,
      email: body.email,
      name: body.name,
      company: body.company,
      phone: body.phone,
      answers: labeledAnswers(doc.gate, body.answers),
      marketingOptIn: body.marketingOptIn,
      alimtalkOptIn: !!body.phone && body.alimtalkOptIn,
      source: { type: leadSourceType, guideId: link.guideId, influencerId: link.influencerId, channelKey: link.channelKey, linkId: link.id },
    });
    await db.update(documentViews).set({ leadId }).where(eq(documentViews.id, view.id));
    await enqueueAutomations(db, { workspaceId: doc.workspaceId, trigger: "gate_passed", leadId, ref: { id: doc.id, guideId: link.guideId } });
    await logEvent(db, doc.workspaceId, "lead_submitted", { link_id: link.id, channel: link.channelKey, source_type: leadSourceType, marketing_opt_in: body.marketingOptIn });
    return c.json({ ok: true });
  })
  // 열람 행동 배치(5초마다 + 페이지를 떠날 때 sendBeacon)
  .post("/doc/:slug/events", async (c) => {
    const db = c.var.db;
    const { doc } = await docForSlug(db, c.req.param("slug"));
    const body = parse(eventsBody, JSON.parse(await c.req.text()));
    const view = await viewFor(db, body.viewToken, doc.id);
    await recordPages(db, doc, view, body.pages);
    const maxPage = Math.min(Math.max(view.maxPage, body.maxPage), doc.pages);
    // 직접 쓴 문서·주소는 1쪽짜리라 쪽수로 완독을 보지 않고 스크롤 95% 도달(클라이언트 completed)만 본다
    const completed = view.completed || body.completed || (doc.sourceType === "pdf" && maxPage >= doc.pages);
    await db
      .update(documentViews)
      .set({ lastSeenAt: now(), maxPage, maxScrollPct: Math.max(view.maxScrollPct, Math.round(body.maxScrollPct)), completed })
      .where(eq(documentViews.id, view.id));
    const justCompleted = completed && !view.completed;
    if (justCompleted && !view.isMember) await logEvent(db, doc.workspaceId, "document_completed", { document_id: doc.id });
    if (justCompleted && view.leadId) await enqueueAutomations(db, { workspaceId: doc.workspaceId, trigger: "document_completed", leadId: view.leadId, ref: { id: doc.id, guideId: doc.guideId } });
    return c.json({ ok: true });
  })
  // PDF 파일. 열기 전 게이트면 통과한 열람 세션만 받는다
  .get("/doc/:slug/file", async (c) => {
    const doc = await openedView(c);
    const obj = await requireObject(c.env.FILES, doc.fileKey, "file_missing", "파일을 찾을 수 없어요.");
    const download = c.req.query("download") === "1" && doc.allowDownload;
    const filename = encodeURIComponent(`${doc.title}.pdf`);
    return new Response(obj.body, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${filename}`, "Cache-Control": "private, no-store", ...NOINDEX },
    });
  })
  // 홈페이지 주소 스냅샷. 뷰어가 같은 출처 iframe(sandbox, 스크립트 없음)으로 띄운다
  .get("/doc/:slug/snapshot", async (c) => {
    const doc = await openedView(c);
    const obj = await requireObject(c.env.FILES, doc.fetchedHtmlKey, "snapshot_missing", "불러온 페이지가 없어요.");
    return snapshotResponse(obj.body);
  });
