import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { documentPageViews, documentViews } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newToken, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { requireObject } from "../../lib/http";
import { upsertLead } from "../../lib/leads";
import { enqueueAutomations } from "../../lib/messaging";
import { snapshotResponse } from "../../lib/snapshot";
import { isBlockedEmail, isFreeEmail, type DocumentGate } from "../../../shared/leads";
import { splitAtGate } from "../../../shared/doc-gate";
import { sanitizeHtml } from "../../../shared/sanitize";
import { NOINDEX, brandName, consentFields, contactFields, isMember, visitorId } from "./shared";
import { docForSlug, gatePassed, gateRequired, openedDoc, passGate, viewFor, type Doc, type DocAccess, type View } from "./doc-access";
import { sendVerifyMail } from "./doc-verify";

// 공개 자료 (/d/:slug): 열람 세션, 리드 게이트, 열람 행동

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

// 이어 보기(v) 또는 새 열람 세션. 같은 방문자의 예전 리드는 출처 집계용으로만 이어 붙인다(통과 여부는 열람 토큰으로 본다)
async function startView(c: Context<AppEnv>, s: DocAccess): Promise<View> {
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

// 직접 쓴 문서 본문. 통과 전에는 게이트 앞 블록까지만 주고, 잘렸으면 그 끝에서 묻도록 비율을 100으로 바꿔 알린다
function editorBody(doc: Doc, passed: boolean) {
  const html = sanitizeHtml(doc.contentHtml ?? "");
  if (passed) return { html, scrollPct: doc.gate.scrollPct };
  if (doc.gate.scrollPct === 0) return { html: null, scrollPct: 0 };
  const { head, rest } = splitAtGate(html, doc.gate.scrollPct);
  return { html: head, scrollPct: rest ? 100 : doc.gate.scrollPct };
}

async function publicDocBody(c: Context<AppEnv>, s: DocAccess, view: View) {
  const { doc, viaForm } = s;
  const g = doc.gate;
  const passed = await gatePassed(c, s, view);
  const open = passed || g.scrollPct >= 100;
  const editor = doc.sourceType === "editor" ? editorBody(doc, passed) : { html: null, scrollPct: g.scrollPct };
  return {
    viewToken: view.id,
    title: doc.title,
    sourceType: doc.sourceType,
    pages: doc.pages,
    allowDownload: doc.allowDownload,
    brandName: await brandName(c.var.db, doc.workspaceId),
    gate: { position: viaForm ? "none" : g.position, scrollPct: editor.scrollPct, fields: g.fields, questions: g.questions, companyEmailOnly: g.companyEmailOnly, requireVerify: g.requireVerify },
    gatePassed: passed,
    html: editor.html,
    hasSnapshot: !!doc.fetchedHtmlKey,
    sourceUrl: open && doc.sourceType === "url" ? doc.sourceUrl : null,
  };
}

// 게이트 입력으로 리드를 저장하고 열람 세션에 붙인다
async function saveGateLead(c: Context<AppEnv>, s: DocAccess, view: View, body: z.infer<typeof gateBody>) {
  const { link, doc } = s;
  // 키워드 DM 링크로 들어온 리드는 게이트를 거쳐도 출처를 DM으로 센다
  const leadSourceType = link.channelKey === "ig_comment_dm" ? "keyword_dm" : "gate";
  const { leadId } = await upsertLead(c.var.db, {
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
  await c.var.db.update(documentViews).set({ leadId }).where(eq(documentViews.id, view.id));
  await logEvent(c.var.db, doc.workspaceId, "lead_submitted", { link_id: link.id, channel: link.channelKey, source_type: leadSourceType, marketing_opt_in: body.marketingOptIn });
  return leadId;
}

export const publicDocRoutes = new Hono<AppEnv>()
  // 공개 자료: 메타, 게이트 설정, 열람 세션 발급. 열람 토큰(t)이 맞으면 본문 전체를 준다
  .get("/doc/:slug", async (c) => {
    const s = await docForSlug(c.var.db, c.req.param("slug"));
    if (s.doc.gate.expiresAt && s.doc.gate.expiresAt < now()) throw new ApiError(410, "document_expired", "열람 기간이 끝난 자료예요.");
    const view = await startView(c, s);
    return c.json(await publicDocBody(c, s, view), 200, NOINDEX);
  })
  // 게이트 제출. 인증이 필요 없으면 열람 토큰을, 필요하면 인증 메일을 보내고 기다리게 한다
  .post("/doc/:slug/gate", async (c) => {
    const slug = c.req.param("slug");
    const s = await docForSlug(c.var.db, slug);
    const body = parse(gateBody, await c.req.json());
    const view = await viewFor(c.var.db, body.viewToken, s.doc.id);
    gateErrors(s.doc.gate, body);
    const leadId = await saveGateLead(c, s, view, body);
    if (s.doc.gate.requireVerify) {
      await sendVerifyMail(c, s.doc, slug, { id: view.id, leadId }, body.email);
      return c.json({ status: "verify_sent" as const, email: body.email });
    }
    return c.json({ status: "passed" as const, unlockToken: await passGate(c, s.doc, leadId, s.link.guideId) });
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
  // PDF 파일. 게이트가 있으면 열람 토큰(t)이 맞는 요청만 받는다
  .get("/doc/:slug/file", async (c) => {
    const doc = await openedDoc(c);
    const obj = await requireObject(c.env.FILES, doc.fileKey, "file_missing", "파일을 찾을 수 없어요.");
    const download = c.req.query("download") === "1" && doc.allowDownload;
    const filename = encodeURIComponent(`${doc.title}.pdf`);
    return new Response(obj.body, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${filename}`, "Cache-Control": "private, no-store", ...NOINDEX },
    });
  })
  // 홈페이지 주소 스냅샷. 뷰어가 같은 출처 iframe(sandbox, 스크립트 없음)으로 띄운다
  .get("/doc/:slug/snapshot", async (c) => {
    const doc = await openedDoc(c);
    const obj = await requireObject(c.env.FILES, doc.fetchedHtmlKey, "snapshot_missing", "불러온 페이지가 없어요.");
    return snapshotResponse(obj.body);
  });
