import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, count, eq, isNull } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { documentViews, formSubmissions, forms, shortLinks } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, newToken, now } from "../../lib/ids";
import { logEvent, logEvents } from "../../lib/events";
import { upsertLead } from "../../lib/leads";
import { enqueueAutomations } from "../../lib/messaging";
import type { FormFields } from "../../../shared/leads";
import { NOINDEX, brandName, consentFields, contactFields, isMember, visitorId } from "./shared";

// 공개 폼 (/form/:slug)

type Answers = Record<string, string | string[]>;
type FormBody = { name?: string; company?: string; phone?: string; answers: Answers };
type Form = typeof forms.$inferSelect;
type Link = typeof shortLinks.$inferSelect;

const submitBody = z.object({
  ...contactFields,
  answers: z.record(z.string(), z.union([z.string().max(2000), z.array(z.string().max(200)).max(30)])).default({}),
  ...consentFields,
});

async function activeFormLink(db: Db, slug: string) {
  const link = await db.select().from(shortLinks).where(eq(shortLinks.slug, slug)).get();
  if (!link || link.deletedAt) throw new ApiError(410, "link_expired", "만료된 링크예요.");
  if (link.destinationType !== "form") throw new ApiError(404, "not_found", "요청한 주소를 찾을 수 없습니다.");
  return link;
}

async function formForSlug(db: Db, slug: string) {
  const link = await activeFormLink(db, slug);
  const form = await db.select().from(forms).where(and(eq(forms.id, link.destinationId ?? ""), isNull(forms.deletedAt))).get();
  if (!form) throw new ApiError(404, "form_not_found", "폼을 찾을 수 없어요.");
  const submitted = form.maxSubmissions ? ((await db.select({ n: count() }).from(formSubmissions).where(eq(formSubmissions.formId, form.id)).get())?.n ?? 0) : 0;
  const closed: "deadline" | "full" | null = form.closesAt && form.closesAt < now() ? "deadline" : form.maxSubmissions && submitted >= form.maxSubmissions ? "full" : null;
  return { link, form, closed, submitted };
}

export function validateFormAnswers(f: FormFields, body: FormBody): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const b of f.base) if (b.enabled && b.required && !body[b.key]) errors[b.key] = "필수 항목이에요.";
  for (const q of f.questions) {
    const a = body.answers[q.id];
    const empty = a === undefined || (Array.isArray(a) ? a.length === 0 : !a.trim());
    if (empty) {
      if (q.required) errors[`answers.${q.id}`] = "필수 항목이에요.";
      continue;
    }
    if ((q.type === "single" || q.type === "multi") && !(Array.isArray(a) ? a : [a]).every((x) => q.options.includes(x))) errors[`answers.${q.id}`] = "보기에서 골라 주세요.";
    if (q.type === "single" && Array.isArray(a)) errors[`answers.${q.id}`] = "하나만 골라 주세요.";
    if (q.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(a))) errors[`answers.${q.id}`] = "날짜 형식이 아니에요.";
  }
  return errors;
}

// 질문 id 기준(제출 기록)과 질문 문구 기준(리드) 두 벌
function splitAnswers(form: Form, answers: Answers) {
  const byId: Answers = {};
  const labeled: Answers = {};
  for (const q of form.fields.questions) {
    const a = answers[q.id];
    if (a !== undefined) (byId[q.id] = a), (labeled[q.label] = a);
  }
  return { byId, labeled };
}

// 제출 후: 연결 자료가 있으면 제출한 사람만 열 수 있게 리드가 붙은 열람 세션을 미리 만든다
async function afterSubmit(c: Context<AppEnv>, form: Form, link: Link, leadId: string) {
  const after = form.afterSubmit;
  if (after.type !== "document" || !after.documentId) return { type: "message", text: after.text };
  const viewToken = newToken(18);
  await c.var.db.insert(documentViews).values({ id: viewToken, documentId: after.documentId, linkId: link.id, sessionId: visitorId(c), leadId, startedAt: now(), lastSeenAt: now(), isMember: await isMember(c, form.workspaceId) });
  return { type: "document", text: after.text, url: `/d/${link.slug}?v=${viewToken}` };
}

export const publicFormRoutes = new Hono<AppEnv>()
  .get("/form/:slug", async (c) => {
    const db = c.var.db;
    const { link, form, closed } = await formForSlug(db, c.req.param("slug"));
    visitorId(c);
    await logEvent(db, form.workspaceId, "form_viewed", { link_id: link.id, channel: link.channelKey });
    const body = {
      title: form.title,
      description: form.description,
      headerImageUrl: form.headerImageKey ? `/api/public/asset/${form.headerImageKey}` : null,
      fields: form.fields,
      brandName: await brandName(db, form.workspaceId),
      closed,
      closedMessage: form.closedMessage,
    };
    return c.json(body, 200, NOINDEX);
  })
  .post("/form/:slug/submit", async (c) => {
    const db = c.var.db;
    const { link, form, closed, submitted } = await formForSlug(db, c.req.param("slug"));
    if (closed) throw new ApiError(410, "form_closed", form.closedMessage || "신청이 마감됐어요.");
    const body = parse(submitBody, await c.req.json());
    const fields = validateFormAnswers(form.fields, body);
    if (Object.keys(fields).length) throw new ApiError(400, "validation_error", "입력값을 확인해 주세요.", fields);
    const { byId, labeled } = splitAnswers(form, body.answers);
    const source = { type: "form" as const, guideId: link.guideId, influencerId: link.influencerId, channelKey: link.channelKey, linkId: link.id };
    const { leadId } = await upsertLead(db, { workspaceId: form.workspaceId, email: body.email, name: body.name, company: body.company, phone: body.phone, answers: labeled, marketingOptIn: body.marketingOptIn, alimtalkOptIn: !!body.phone && body.alimtalkOptIn, source });
    await db.insert(formSubmissions).values({ id: newId(), formId: form.id, leadId, linkId: link.id, answers: byId, at: now() });
    await enqueueAutomations(db, { workspaceId: form.workspaceId, trigger: "form_submitted", leadId, ref: { id: form.id, guideId: link.guideId } });
    const props = { link_id: link.id, channel: link.channelKey, marketing_opt_in: body.marketingOptIn };
    await logEvents(db, form.workspaceId, [
      ["form_submitted", props],
      ["lead_submitted", { ...props, source_type: "form" }],
    ]);
    if (form.maxSubmissions && submitted + 1 >= form.maxSubmissions) await logEvent(db, form.workspaceId, "form_closed", { reason: "full" });
    return c.json(await afterSubmit(c, form, link, leadId));
  });
