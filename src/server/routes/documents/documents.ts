import { Hono } from "hono";
import { z } from "zod";
import { and, count, countDistinct, desc, eq, isNull, sql, sum } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { documentViews, documents } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { requireObject } from "../../lib/http";
import { getGuide } from "../../lib/guides";
import { snapshotResponse } from "../../lib/snapshot";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import type { DocJson } from "../../../shared/leads";
import { sanitizeHtml } from "../../../shared/sanitize";
import { gateSchema, newDocument, notMember, ownDocument, takeSnapshot, toClient, urlSchema } from "./shared";

// 자료: PDF 올리기, 직접 쓰기, 홈페이지 주소

const MB = 1024 * 1024;
const MAX_BYTES = 50 * MB;
const MAX_CONTENT = 500_000;
const uploadQuery = z.object({ title: z.string().trim().min(1).max(120), pages: z.coerce.number().int().min(1).max(2000), guideId: z.string().optional() });
const newBody = z.discriminatedUnion("sourceType", [
  z.object({ sourceType: z.literal("editor"), title: z.string().trim().min(1).max(120), guideId: z.string().optional() }),
  z.object({ sourceType: z.literal("url"), title: z.string().trim().min(1).max(120), url: urlSchema, guideId: z.string().optional() }),
]);
const patchBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  allowDownload: z.boolean().optional(),
  gate: gateSchema.optional(),
  guideId: z.string().nullable().optional(),
  // 직접 쓴 문서 본문. HTML 은 에디터가 만든 것을 받아 허용 목록으로 걸러 저장한다
  content: z.object({ json: z.record(z.string(), z.unknown()), html: z.string().max(MAX_CONTENT) }).optional(),
});
const tooLarge = () => new ApiError(413, "file_too_large", "50MB 이하 PDF만 올릴 수 있어요.");

// 본문 크기·형식 확인 후 PDF 바이트
async function readPdf(req: Request, declaredLength: number) {
  if (declaredLength > MAX_BYTES) throw tooLarge();
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw tooLarge();
  if (new TextDecoder().decode(buf.slice(0, 5)) !== "%PDF-") throw new ApiError(400, "not_pdf", "PDF 파일만 올릴 수 있어요.");
  return buf;
}

export const documentCrudRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const guideId = c.req.query("guideId");
    const rows = await db
      .select()
      .from(documents)
      .where(and(eq(documents.workspaceId, workspace.id), isNull(documents.deletedAt), guideId ? eq(documents.guideId, guideId) : undefined))
      .orderBy(desc(documents.createdAt));
    const stats = await db
      .select({ documentId: documentViews.documentId, views: count(), completed: sum(sql`${documentViews.completed}`).mapWith(Number), leads: countDistinct(documentViews.leadId) })
      .from(documentViews)
      .innerJoin(documents, eq(documents.id, documentViews.documentId))
      .where(and(eq(documents.workspaceId, workspace.id), notMember))
      .groupBy(documentViews.documentId);
    return c.json({ documents: rows.map((d) => ({ ...toClient(d), stats: stats.find((s) => s.documentId === d.id) ?? { views: 0, completed: 0, leads: 0 } })) });
  })
  // 본문 = PDF 바이트. 제목·페이지 수(클라이언트가 pdfjs 로 읽음)·가이드는 쿼리로 받는다
  .post("/", editorsOnly, async (c) => {
    const q = parse(uploadQuery, c.req.query());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    if (q.guideId) await getGuide(db, workspace.id, q.guideId);
    const buf = await readPdf(c.req.raw, Number(c.req.header("content-length") ?? 0));
    const id = newId();
    const fileKey = `documents/${workspace.id}/${id}.pdf`;
    await c.env.FILES.put(fileKey, buf, { httpMetadata: { contentType: "application/pdf" } });
    const sizeMb = Math.round((buf.byteLength / MB) * 100) / 100;
    const [doc] = await db
      .insert(documents)
      .values({ ...newDocument(id, workspace.id, q.title, q.guideId), fileKey, pages: q.pages, sizeMb, sourceType: "pdf" })
      .returning();
    await logEvent(db, workspace.id, "document_uploaded", { pages: q.pages, document_id: id, source_type: "pdf" });
    return c.json({ document: toClient(doc!) }, 201);
  })
  // 직접 쓰기(editor) 또는 홈페이지 주소(url) 자료 만들기. 주소는 바로 스냅샷을 뜬다
  .post("/new", editorsOnly, async (c) => {
    const body = parse(newBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    if (body.guideId) await getGuide(db, workspace.id, body.guideId);
    const id = newId();
    const editor = body.sourceType === "editor";
    const snap = body.sourceType === "url" ? await takeSnapshot(c.env, workspace.id, id, body.url) : {};
    const [doc] = await db
      .insert(documents)
      .values({
        ...newDocument(id, workspace.id, body.title, body.guideId),
        fileKey: "",
        pages: 1,
        sizeMb: 0,
        sourceType: body.sourceType,
        contentJson: editor ? { type: "doc", content: [{ type: "paragraph" }] } : null,
        contentHtml: editor ? "<p></p>" : null,
        sourceUrl: body.sourceType === "url" ? body.url : null,
        ...snap,
      })
      .returning();
    await logEvent(db, workspace.id, "document_uploaded", { pages: 1, document_id: id, source_type: body.sourceType });
    return c.json({ document: toClient(doc!, true) }, 201);
  })
  .get("/:id", async (c) => c.json({ document: toClient(await ownDocument(c, c.req.param("id")), true) }))
  .patch("/:id", editorsOnly, async (c) => {
    const body = parse(patchBody, await c.req.json());
    const doc = await ownDocument(c, c.req.param("id"));
    if (body.guideId) await getGuide(c.var.db, doc.workspaceId, body.guideId);
    const { content, ...rest } = body;
    if (content && doc.sourceType !== "editor") throw new ApiError(400, "not_editor", "직접 쓴 문서만 본문을 고칠 수 있어요.");
    if (content && JSON.stringify(content.json).length > MAX_CONTENT) throw new ApiError(413, "content_too_large", "문서가 너무 길어요. 나눠서 만들어 주세요.");
    const contentSet = content ? { contentJson: content.json as DocJson, contentHtml: sanitizeHtml(content.html) } : {};
    await c.var.db.update(documents).set({ ...rest, ...contentSet }).where(eq(documents.id, doc.id));
    return c.json({ ok: true, savedAt: now() });
  })
  // 홈페이지 주소 다시 불러오기
  .post("/:id/refetch", editorsOnly, async (c) => {
    const doc = await ownDocument(c, c.req.param("id"));
    if (doc.sourceType !== "url" || !doc.sourceUrl) throw new ApiError(400, "not_url", "홈페이지 주소 자료가 아니에요.");
    const snap = await takeSnapshot(c.env, doc.workspaceId, doc.id, doc.sourceUrl);
    await c.var.db.update(documents).set(snap).where(eq(documents.id, doc.id));
    return c.json({ document: toClient({ ...doc, ...snap }, true) });
  })
  // 편집 화면 미리보기용 원본 (PDF 파일, 주소 스냅샷)
  .get("/:id/file", async (c) => {
    const doc = await ownDocument(c, c.req.param("id"));
    const obj = await requireObject(c.env.FILES, doc.fileKey, "file_missing", "파일을 찾을 수 없어요.");
    return new Response(obj.body, { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store" } });
  })
  .get("/:id/snapshot", async (c) => {
    const doc = await ownDocument(c, c.req.param("id"));
    const obj = await requireObject(c.env.FILES, doc.fetchedHtmlKey, "snapshot_missing", "불러온 페이지가 없어요.");
    return snapshotResponse(obj.body);
  })
  .delete("/:id", editorsOnly, async (c) => {
    const doc = await ownDocument(c, c.req.param("id"));
    await c.var.db.update(documents).set({ deletedAt: now() }).where(eq(documents.id, doc.id));
    return c.json({ ok: true });
  });
