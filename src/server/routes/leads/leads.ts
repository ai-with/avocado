import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { documentPageViews, documentViews, documents, formSubmissions, forms, leadSources, leadTagLinks, leads } from "../../db/schema";
import { parse } from "../../lib/errors";
import { now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { csvResponse } from "../../lib/http";
import { upsertLead } from "../../lib/leads";
import { documentOpenedAt } from "../../lib/document-metrics";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { leadsCsv } from "./export";
import { emailSchema, filteredLeads, lookups, ownLead, publicLead } from "./shared";

// 리드 목록·추가·가져오기·내보내기·상세·삭제

const IMPORT_MAX_ROWS = 100;
const PAGE_DWELL_VIEWS = 50;
// 열이 없거나 값이 동의로 읽히지 않으면 '동의 없음'
const OPT_IN_RE = /^(y|yes|true|1|o|동의|예)$/i;
const createBody = z.object({ email: emailSchema, name: z.string().max(100).optional(), company: z.string().max(100).optional(), phone: z.string().max(30).optional(), marketingOptIn: z.boolean().default(false) });
const importRow = z.object({ email: z.string(), name: z.string().optional(), company: z.string().optional(), phone: z.string().optional(), marketing_opt_in: z.string().optional() });
const importBody = z.object({
  consentConfirmed: z.literal(true, { error: "수신 동의를 받은 연락처만 올린다는 확인이 필요해요." }),
  rows: z.array(importRow).min(1).max(IMPORT_MAX_ROWS),
});

// ponytail: 행마다 upsertLead(쿼리 3~4개). 유료 플랜의 호출당 쿼리 한도(1000) 안에 들도록 100행 제한
async function importRows(db: Db, workspaceId: string, rows: z.infer<typeof importRow>[]) {
  let imported = 0;
  const invalid: number[] = [];
  for (const [i, row] of rows.entries()) {
    const email = emailSchema.safeParse(row.email);
    if (!email.success) {
      invalid.push(i);
      continue;
    }
    const optIn = OPT_IN_RE.test((row.marketing_opt_in ?? "").trim());
    await upsertLead(db, { workspaceId, email: email.data, name: row.name, company: row.company, phone: row.phone, marketingOptIn: optIn, source: { type: "import" } });
    imported++;
  }
  return { imported, invalid };
}

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
    const [rows, lk] = await Promise.all([filteredLeads(db, workspace.id, c.req.query()), lookups(db, workspace.id)]);
    return c.json({ leads: rows.map(({ lead, facts }) => ({ ...publicLead(lead), tagIds: facts.tagIds, sourceTypes: [...new Set(facts.sources.map((s) => s.type))] })), lookups: lk });
  })
  .post("/", editorsOnly, async (c) => {
    const body = parse(createBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const r = await upsertLead(c.var.db, { workspaceId: workspace.id, ...body, source: { type: "manual" } });
    return c.json(r, 201);
  })
  // CSV 가져오기. 클라이언트가 열 매핑까지 끝낸 행을 100행씩 보낸다
  .post("/import", editorsOnly, async (c) => {
    const body = parse(importBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const r = await importRows(c.var.db, workspace.id, body.rows);
    await logEvent(c.var.db, workspace.id, "lead_imported", { rows: r.imported });
    return c.json(r);
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
  // soft 삭제. TODO: 삭제 요청 후 7일 안에 개인정보(이메일·이름·전화·답변)를 실제로 지우는 Cron 작업 추가
  .delete("/:id", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const lead = await ownLead(c.var.db, workspace.id, c.req.param("id"));
    await c.var.db.update(leads).set({ deletedAt: now() }).where(eq(leads.id, lead.id));
    await logEvent(c.var.db, workspace.id, "lead_deleted", {});
    return c.json({ ok: true });
  });
