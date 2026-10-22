import type { Context } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { documents, documentViews } from "../../db/schema";
import { now } from "../../lib/ids";
import { findLive } from "../../lib/owned";
import { fetchSnapshot } from "../../lib/snapshot";
import { workspaceCtx } from "../../middleware/auth";
import { DEFAULT_GATE, MAX_QUESTIONS } from "../../../shared/leads";
import { normalizeGate } from "../../../shared/doc-gate";

// 자료 라우트 공용

export const gateSchema = z.object({
  position: z.enum(["none", "scroll"]),
  scrollPct: z.number().int().min(0).max(100),
  fields: z.object({ name: z.boolean(), company: z.boolean(), phone: z.boolean() }),
  questions: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().trim().min(1, "질문을 넣어 주세요.").max(200), required: z.boolean() })).max(MAX_QUESTIONS, `질문은 최대 ${MAX_QUESTIONS}개예요.`),
  companyEmailOnly: z.boolean(),
  requireVerify: z.boolean(),
  blockedEmails: z.array(z.string().trim().max(200)).max(500),
  expiresAt: z.number().int().nullable(),
});

export const urlSchema = z
  .string()
  .trim()
  .max(2000)
  .pipe(z.url({ protocol: /^https?$/, error: "http 또는 https 로 시작하는 주소를 넣어 주세요." }));

// 구성원 열람은 집계에서 뺀다
export const notMember = eq(documentViews.isMember, false);

type DocRow = typeof documents.$inferSelect;
// 목록·상세 응답. 게이트는 항상 새 형식, 본문은 상세에서만 보낸다
export const toClient = ({ contentJson, contentHtml, ...d }: DocRow, withContent = false) => ({
  ...d,
  gate: normalizeGate(d.gate, d.pages),
  ...(withContent ? { contentJson, contentHtml } : {}),
});

// 새 자료 행의 공통 기본값
export const newDocument = (id: string, workspaceId: string, title: string, guideId: string | undefined) => ({
  id,
  workspaceId,
  guideId: guideId ?? null,
  title,
  allowDownload: false,
  gate: DEFAULT_GATE,
  createdAt: now(),
});

const snapshotKey = (workspaceId: string, id: string) => `documents/${workspaceId}/${id}.html`;

// 홈페이지 주소를 떠서 R2 에 둔다. 실패하면 key 를 비워 '새 창으로 열기만' 상태로 둔다
export async function takeSnapshot(env: Env, workspaceId: string, id: string, url: string) {
  try {
    const html = await fetchSnapshot(url);
    const key = snapshotKey(workspaceId, id);
    await env.FILES.put(key, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    return { fetchedHtmlKey: key, fetchedAt: now() };
  } catch {
    return { fetchedHtmlKey: null, fetchedAt: now() };
  }
}

export function ownDocument(c: Context<AppEnv>, id: string) {
  const { workspace } = workspaceCtx(c);
  return findLive(c.var.db, documents, id, workspace.id, { code: "document_not_found", message: "자료를 찾을 수 없습니다." });
}
