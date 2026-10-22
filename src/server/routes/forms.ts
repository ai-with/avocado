import { Hono } from "hono";
import { z } from "zod";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { AppEnv } from "../types";
import { documents, formSubmissions, forms, leads } from "../db/schema";
import { ApiError, parse } from "../lib/errors";
import { newId, now } from "../lib/ids";
import { logEvent } from "../lib/events";
import { editorsOnly, workspaceCtx } from "../middleware/auth";
import { DEFAULT_FORM_FIELDS, MAX_QUESTIONS } from "../../shared/leads";
import { getGuide } from "../lib/guides";

const fieldsSchema = z.object({
  base: z
    .array(z.object({ key: z.enum(["name", "company", "phone"]), enabled: z.boolean(), required: z.boolean() }))
    .length(3)
    .refine((b) => new Set(b.map((x) => x.key)).size === 3, "기본 항목이 중복됐어요."),
  questions: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        type: z.enum(["short", "long", "single", "multi", "date"]),
        label: z.string().trim().min(1, "질문을 넣어 주세요.").max(200),
        required: z.boolean(),
        options: z.array(z.string().trim().min(1).max(100)).max(30),
      }),
    )
    .max(MAX_QUESTIONS, `질문은 최대 ${MAX_QUESTIONS}개예요.`),
});

export const formBodySchema = z.object({
  title: z.string().trim().min(1, "제목을 넣어 주세요.").max(120),
  description: z.string().max(2000),
  headerImageKey: z.string().max(200).nullable(),
  guideId: z.string().nullable(),
  fields: fieldsSchema,
  closesAt: z.number().int().nullable(),
  maxSubmissions: z.number().int().min(1).nullable(),
  closedMessage: z.string().max(500),
  afterSubmit: z.object({ type: z.enum(["message", "document"]), text: z.string().max(1000), documentId: z.string().nullable() }),
});

async function ownForm(c: Parameters<typeof workspaceCtx>[0], id: string) {
  const { workspace } = workspaceCtx(c);
  const form = await c.var.db.select().from(forms).where(and(eq(forms.id, id), eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt))).get();
  if (!form) throw new ApiError(404, "form_not_found", "폼을 찾을 수 없습니다.");
  return form;
}

async function checkRefs(c: Parameters<typeof workspaceCtx>[0], body: Partial<z.infer<typeof formBodySchema>>) {
  const { workspace } = workspaceCtx(c);
  if (body.guideId) await getGuide(c.var.db, workspace.id, body.guideId);
  const docId = body.afterSubmit?.type === "document" ? body.afterSubmit.documentId : null;
  if (body.afterSubmit?.type === "document") {
    const doc = docId && (await c.var.db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, docId), eq(documents.workspaceId, workspace.id), isNull(documents.deletedAt))).get());
    if (!doc) throw new ApiError(400, "validation_error", "제출 후 연결할 자료를 골라 주세요.", { "afterSubmit.documentId": "자료를 골라 주세요." });
  }
}

export const formRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const guideId = c.req.query("guideId");
    const rows = await db
      .select()
      .from(forms)
      .where(and(eq(forms.workspaceId, workspace.id), isNull(forms.deletedAt), guideId ? eq(forms.guideId, guideId) : undefined))
      .orderBy(desc(forms.createdAt));
    const counts = await db
      .select({ formId: formSubmissions.formId, n: count() })
      .from(formSubmissions)
      .innerJoin(forms, eq(forms.id, formSubmissions.formId))
      .where(eq(forms.workspaceId, workspace.id))
      .groupBy(formSubmissions.formId);
    return c.json({ forms: rows.map((f) => ({ ...f, submissions: counts.find((x) => x.formId === f.id)?.n ?? 0 })) });
  })
  .post("/", editorsOnly, async (c) => {
    const raw = await c.req.json();
    const body = parse(formBodySchema.partial({ description: true, headerImageKey: true, guideId: true, fields: true, closesAt: true, maxSubmissions: true, closedMessage: true, afterSubmit: true }), raw);
    await checkRefs(c, body);
    const { workspace } = workspaceCtx(c);
    const form = {
      id: newId(),
      workspaceId: workspace.id,
      title: body.title,
      description: body.description ?? "",
      headerImageKey: body.headerImageKey ?? null,
      guideId: body.guideId ?? null,
      fields: body.fields ?? DEFAULT_FORM_FIELDS,
      closesAt: body.closesAt ?? null,
      maxSubmissions: body.maxSubmissions ?? null,
      closedMessage: body.closedMessage ?? "신청이 마감됐어요. 관심 가져 주셔서 고마워요.",
      afterSubmit: body.afterSubmit ?? { type: "message" as const, text: "신청이 접수됐어요. 곧 연락드릴게요.", documentId: null },
      createdAt: now(),
    };
    await c.var.db.insert(forms).values(form);
    await logEvent(c.var.db, workspace.id, "form_created", { question_count: form.fields.questions.length });
    return c.json({ form }, 201);
  })
  .get("/:id", async (c) => c.json({ form: await ownForm(c, c.req.param("id")) }))
  .patch("/:id", editorsOnly, async (c) => {
    const body = parse(formBodySchema.partial(), await c.req.json());
    const form = await ownForm(c, c.req.param("id"));
    await checkRefs(c, body);
    await c.var.db.update(forms).set(body).where(eq(forms.id, form.id));
    return c.json({ ok: true });
  })
  .delete("/:id", editorsOnly, async (c) => {
    const form = await ownForm(c, c.req.param("id"));
    await c.var.db.update(forms).set({ deletedAt: now() }).where(eq(forms.id, form.id));
    return c.json({ ok: true });
  })
  .get("/:id/submissions", async (c) => {
    const form = await ownForm(c, c.req.param("id"));
    const rows = await c.var.db
      .select({ id: formSubmissions.id, at: formSubmissions.at, answers: formSubmissions.answers, leadId: leads.id, email: leads.email, name: leads.name })
      .from(formSubmissions)
      .leftJoin(leads, eq(leads.id, formSubmissions.leadId))
      .where(eq(formSubmissions.formId, form.id))
      .orderBy(desc(formSubmissions.at))
      .limit(500);
    return c.json({ submissions: rows });
  });
