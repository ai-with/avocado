import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { documentPageViews, documentViews, documents, formSubmissions, forms, leadSources, leadTagLinks, leads } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { csvResponse } from "../../lib/http";
import { upsertLead } from "../../lib/leads";
import { documentOpenedAt } from "../../lib/document-metrics";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { leadsCsv } from "./export";
import { emailSchema, filteredLeads, lookups, ownLead, publicLead } from "./shared";
import { leadPage } from "../../lib/lead-query";
import { boundedLeadLookups, leadLookupPage, lookupKinds, type LookupKind } from "../../lib/lead-lookups";

// 리드 목록·추가·가져오기·내보내기·상세·삭제

const PAGE_DWELL_VIEWS = 50;
const createBody = z.object({ email: emailSchema, name: z.string().max(100).optional(), company: z.string().max(100).optional(), phone: z.string().max(30).optional(), marketingOptIn: z.boolean().default(false) });

// 상세: 출처 누적, 열람 기록(페이지별 체류), 제출 답변
async function leadActivity(db: Db, leadId: string) {
  const [sources, views, submissions, tagIds] = await Promise.all([
    db.select().from(leadSources).where(eq(leadSources.leadId, leadId)).orderBy(desc(leadSources.at)),
    db
      .select({ id: documentViews.id, title: documents.title, pages: documents.pages, maxPage: documentViews.maxPage, completed: documentViews.completed, startedAt: documentOpenedAt, lastSeenAt: documentViews.lastSeenAt })
      .from(documentViews)
      .innerJoin(documents, eq(documents.id, documentViews.documentId))
      .where(and(eq(documentViews.leadId, leadId), isNotNull(documentViews.openedAt)))
      .orderBy(desc(documentOpenedAt)),
    db
      .select({ id: formSubmissions.id, formTitle: forms.title, fields: forms.fields, answers: formSubmissions.answers, at: formSubmissions.at })
      .from(formSubmissions)
      .innerJoin(forms, eq(forms.id, formSubmissions.formId))
      .where(eq(formSubmissions.leadId, leadId))
      .orderBy(desc(formSubmissions.at)),
    db.select({ tagId: leadTagLinks.tagId }).from(leadTagLinks).where(eq(leadTagLinks.leadId, leadId)),
  ]);
  const pageRows = views.length ? await db.select().from(documentPageViews).where(inArray(documentPageViews.viewId, views.slice(0, PAGE_DWELL_VIEWS).map((v) => v.id))) : [];
  return {
    tagIds: tagIds.map((t) => t.tagId),
    sources,
    views: views.map((v) => ({ ...v, pageDwell: pageRows.filter((p) => p.viewId === v.id).map((p) => ({ page: p.page, dwellMs: p.dwellMs })) })),
    submissions: submissions.map((s) => ({ ...s, questions: s.fields.questions.map((q) => ({ id: q.id, label: q.label })) })),
  };
}

export const leadCrudRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const { rows, nextCursor } = await leadPage(db, c.env, workspace.id, c.req.query());
    const q = c.req.query();
    const lk = await boundedLeadLookups(db, workspace.id, { guides: [...rows.flatMap((r) => r.lead.lastSource.guideId ? [r.lead.lastSource.guideId] : []), ...(q.guideId ? [q.guideId] : [])], influencers: [...rows.flatMap((r) => r.lead.lastSource.influencerId ? [r.lead.lastSource.influencerId] : []), ...(q.influencerId ? [q.influencerId] : [])], contents: [...rows.flatMap((r) => r.lead.lastSource.linkId ? [r.lead.lastSource.linkId] : []), ...(q.contentLinkId ? [q.contentLinkId] : [])], tags: [...new Set([...rows.flatMap((r) => r.facts.tagIds), ...(q.tagId ? [q.tagId] : [])])], channels: q.channelKey ? [q.channelKey] : [] });
    return c.json({ leads: rows.map(({ lead, facts }) => ({ ...publicLead(lead), tagIds: facts.tagIds, sourceTypes: [...new Set(facts.sources.map((s) => s.type))] })), ...lk, nextCursor });
  })
  .get("/lookups", async (c) => {
    const { workspace } = workspaceCtx(c), kind = c.req.query("kind") as LookupKind;
    if (!lookupKinds.includes(kind)) throw new ApiError(400, "invalid_lookup", "필터 목록을 확인해 주세요.");
    let selected: string[];
    try { selected = parse(z.array(z.string().max(200)).max(50), JSON.parse(c.req.query("selected") ?? "[]")); } catch { throw new ApiError(400, "invalid_lookup", "선택한 필터를 확인해 주세요."); }
    return c.json(await leadLookupPage(c.var.db, workspace.id, kind, c.req.query("cursor") ?? "", selected));
  })
  .post("/", editorsOnly, async (c) => {
    const body = parse(createBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const r = await upsertLead(c.var.db, { workspaceId: workspace.id, ...body, source: { type: "manual" } });
    return c.json(r, 201);
  })
  .get("/export", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const [rows, lk] = await Promise.all([filteredLeads(db, workspace.id, c.req.query()), lookups(db, workspace.id)]);
    const csv = leadsCsv(rows, lk);
    await logEvent(db, workspace.id, "lead_exported", { rows: rows.length });
    return csvResponse(csv, "leads.csv");
  })
  .get("/:id", async (c) => {
    const { workspace } = workspaceCtx(c);
    const lead = await ownLead(c.var.db, workspace.id, c.req.param("id"));
    const activity = await leadActivity(c.var.db, lead.id);
    // TODO(TASK-021): 자동·1회성 발송 기록(message_logs)을 붙인다
    return c.json({ lead: publicLead(lead), ...activity, messages: [] });
  })
  .delete("/:id/tags/:tagId", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const lead = await ownLead(c.var.db, workspace.id, c.req.param("id"));
    await c.var.db.delete(leadTagLinks).where(and(eq(leadTagLinks.leadId, lead.id), eq(leadTagLinks.tagId, c.req.param("tagId"))));
    return c.json({ ok: true });
  })
  // 삭제 요청은 즉시 화면에서 숨기고, 개인정보는 정리 Cron이 7일 안에 파기한다.
  .delete("/:id", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const lead = await ownLead(c.var.db, workspace.id, c.req.param("id"));
    await c.var.db.update(leads).set({ deletedAt: now() }).where(eq(leads.id, lead.id));
    await logEvent(c.var.db, workspace.id, "lead_deleted", {});
    return c.json({ ok: true });
  });
