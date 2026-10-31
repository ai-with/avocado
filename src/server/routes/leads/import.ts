import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../types";
import { ApiError, parse } from "../../lib/errors";
import { workspaceCtx } from "../../middleware/auth";
import { applyImportChunk, cancelImportJob, createImportJob, getImportJob, importContext, requireImportCsrf } from "../../lib/lead-imports";
import { IMPORT_BODY_BYTES, IMPORT_CHUNK_ROWS } from "../../../shared/lead-imports";

const text = (max: number) => z.string().max(max).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "줄바꿈과 제어 문자를 빼 주세요.");
const row = z.object({ email: text(254), name: text(100).optional(), company: text(100).optional(), phone: text(30).optional(), marketing_opt_in: text(16).optional() }).strict();
const consent = z.literal(true, { error: "수신 동의를 받은 연락처만 올린다는 확인이 필요해요." });
const generation = z.string().min(1).max(100);
const create = z.object({ consentConfirmed: consent, requestId: z.uuid(), requestedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), totalRows: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict();
const chunk = z.object({ consentConfirmed: consent, generation, chunkNo: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), rows: z.array(row).min(1).max(IMPORT_CHUNK_ROWS) }).strict();
async function body(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > IMPORT_BODY_BYTES) throw new ApiError(413, "import_body_large", "한 번에 올린 내용이 커요. 파일의 열 길이를 확인해 주세요.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "import_body_invalid", "가져오기 내용을 확인해 주세요.");
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IMPORT_BODY_BYTES) { await reader.cancel(); throw new ApiError(413, "import_body_large", "한 번에 올린 내용이 커요. 파일의 열 길이를 확인해 주세요."); }
      parts.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, "import_body_invalid", "가져오기 내용을 확인해 주세요."); }
  finally { reader.releaseLock(); }
}
function actor(c: Parameters<typeof workspaceCtx>[0]) {
  const auth = workspaceCtx(c);
  if (auth.role !== "owner" && auth.role !== "editor") throw new ApiError(403, "forbidden", "소유자·편집자만 리드를 가져올 수 있어요.");
  return auth;
}
// Never expose raw D1 causes: bound parameters contain transient contact values.
const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
  try { return await work(); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(503, "import_unavailable", "가져오기 상태를 확인하지 못했어요. 같은 파일로 다시 확인해 주세요."); }
};
export const leadImportRoutes = new Hono<AppEnv>()
  .get("/import/context", async (c) => {
    const auth = actor(c);
    return c.json(await guarded(() => importContext(c.env, auth, auth.workspace.id)));
  })
  .post("/import/jobs", async (c) => {
    // Required consent/input validation precedes import-specific authority IO.
    const input = parse(create, await body(c.req.raw)), auth = actor(c);
    await requireImportCsrf(c.env, auth, auth.workspace.id, c.req.header("Origin"), c.req.header("X-CSRF-Token"));
    return c.json(await guarded(() => createImportJob(c.env, auth, auth.workspace.id, input)));
  })
  .get("/import/jobs/:id", async (c) => {
    const id = parse(z.uuid(), c.req.param("id")), auth = actor(c);
    return c.json(await guarded(() => getImportJob(c.env, auth, auth.workspace.id, id)));
  })
  .post("/import/jobs/:id/chunks", async (c) => {
    const input = parse(chunk, await body(c.req.raw)), id = parse(z.uuid(), c.req.param("id")), auth = actor(c);
    await requireImportCsrf(c.env, auth, auth.workspace.id, c.req.header("Origin"), c.req.header("X-CSRF-Token"));
    return c.json(await guarded(() => applyImportChunk(c.env, auth, auth.workspace.id, id, input)));
  })
  .post("/import/jobs/:id/cancel", async (c) => {
    const input = parse(z.object({ generation }).strict(), await body(c.req.raw)), id = parse(z.uuid(), c.req.param("id")), auth = actor(c);
    await requireImportCsrf(c.env, auth, auth.workspace.id, c.req.header("Origin"), c.req.header("X-CSRF-Token"));
    return c.json(await guarded(() => cancelImportJob(c.env, auth, auth.workspace.id, id, input.generation)));
  });
