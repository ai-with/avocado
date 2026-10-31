import { and, eq, sql, type SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { Db } from "../db";
import { contents, type Content } from "../db/schema";
import { collectionAllowed } from "./content-collection";
import { newId, now } from "./ids";
import { z } from "zod";
import { getDb } from "../db";

export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
export const THUMBNAIL_TIMEOUT_MS = 8_000;
export const THUMBNAIL_ORPHAN_GRACE_MS = 30 * 60 * 1000;
const SWEEP_BATCH = 100;
const TOKEN = /^[\w-]+$/;
const dialect = new SQLiteSyncDialect();
const nativeBatch = (db: Db, statements: SQL[]) => db.$client.batch(statements.map((statement) => {
  const query = dialect.sqlToQuery(statement);
  return db.$client.prepare(query.sql).bind(...query.params);
}));

// Instagram/Meta가 내려준 CDN 주소만 받아 임의 내부 주소나 인증 정보로 접근하지 않는다.
export function thumbnailSource(raw: string): URL | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const allowed = ["cdninstagram.com", "fbcdn.net"].some((domain) => host === domain || host.endsWith(`.${domain}`));
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && allowed ? url : null;
  } catch { return null; }
}

export function ownedThumbnailKey(key: string, workspaceId: string, contentId: string): boolean {
  if (!TOKEN.test(workspaceId) || !TOKEN.test(contentId)) return false;
  return new RegExp(`^content-thumbnails/${workspaceId}/${contentId}/[\\w-]+\\.(jpg|png|webp|gif)$`).test(key);
}

const cleanupJob = z.object({ workspaceId: z.string().min(1).max(100), contentId: z.string().min(1).max(100), key: z.string().min(1).max(400) });

async function claimThumbnail(db: Db, job: z.infer<typeof cleanupJob>) {
  const at = now();
  // 옛 버전의 정리 메시지도 현재 참조가 아닌, 정확한 소유 키만 원장에 편입한다.
  await db.run(sql`INSERT INTO content_thumbnail_objects (key,workspace_id,content_id,created_at)
    VALUES (${job.key},${job.workspaceId},${job.contentId},${now()}) ON CONFLICT(key) DO NOTHING`);
  const result = await nativeBatch(db, [
    sql`UPDATE content_thumbnail_objects SET retired_at=coalesce(retired_at,${at}),checked_at=${at}
      WHERE key=${job.key} AND workspace_id=${job.workspaceId} AND content_id=${job.contentId}
      AND NOT EXISTS (SELECT 1 FROM contents c WHERE c.thumbnail_key=content_thumbnail_objects.key AND c.deleted_at IS NULL)
      RETURNING key`,
    sql`UPDATE contents SET thumbnail_key=NULL,thumbnail_url=NULL,thumbnail_fetched_at=NULL WHERE thumbnail_key=${job.key} AND deleted_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM content_thumbnail_objects o WHERE o.key=${job.key} AND o.retired_at IS NOT NULL AND o.checked_at=${at})`,
  ]);
  return result[0]!.results as { key: string }[];
}

async function deleteClaimedThumbnails(env: Env, db: Db, keys: string[]) {
  if (!keys.length) return;
  await env.FILES.delete(keys);
  await db.run(sql`UPDATE content_thumbnail_objects SET deleted_at=${now()},checked_at=${now()}
    WHERE key IN (SELECT value FROM json_each(${JSON.stringify(keys)})) AND retired_at IS NOT NULL`);
}

export async function processThumbnailCleanup(raw: unknown, env: Env): Promise<void> {
  const job = cleanupJob.parse(raw);
  if (!ownedThumbnailKey(job.key, job.workspaceId, job.contentId)) throw new Error("thumbnail_key_rejected");
  const db = getDb(env.DB);
  const claimed = await claimThumbnail(db, job);
  await deleteClaimedThumbnails(env, db, claimed.map((row) => row.key));
}

// 미참조 확인과 파기 표시는 같은 SQL로 확정한다. 늦은 쓰기의 최종 CAS도 이 표시를 검사한다.
export async function retireThumbnail(env: Env, db: Db, workspaceId: string, contentId: string, key: string): Promise<void> {
  if (!ownedThumbnailKey(key, workspaceId, contentId)) return;
  try {
    const claimed = await claimThumbnail(db, { key, workspaceId, contentId });
    await deleteClaimedThumbnails(env, db, claimed.map((row) => row.key));
  } catch {
    await env.PIPELINE.send({ type: "cleanup_content_thumbnail", payload: { workspaceId, contentId, key } });
  }
}

// 원장은 FK cascade로 지우지 않는다. 부모가 사라지거나 put 뒤 Worker가 종료돼도 다음 실행에서 회수한다.
export async function processThumbnailSweep(raw: unknown, env: Env): Promise<void> {
  z.object({}).strict().parse(raw);
  const db = getDb(env.DB), at = now();
  const result = await nativeBatch(db, [
    sql`UPDATE content_thumbnail_objects SET retired_at=coalesce(retired_at,${at}),checked_at=${at}
      WHERE key IN (
        SELECT o.key FROM content_thumbnail_objects o
        WHERE (o.retired_at IS NOT NULL OR o.created_at<=${at - THUMBNAIL_ORPHAN_GRACE_MS})
        AND NOT EXISTS(SELECT 1 FROM contents c WHERE c.thumbnail_key=o.key AND c.deleted_at IS NULL)
        ORDER BY o.checked_at,o.created_at,o.key LIMIT ${SWEEP_BATCH}
      ) AND NOT EXISTS(SELECT 1 FROM contents c WHERE c.thumbnail_key=content_thumbnail_objects.key AND c.deleted_at IS NULL)
      RETURNING key,workspace_id AS workspaceId,content_id AS contentId`,
    sql`UPDATE contents SET thumbnail_key=NULL,thumbnail_url=NULL,thumbnail_fetched_at=NULL WHERE deleted_at IS NOT NULL
      AND thumbnail_key IN (SELECT key FROM content_thumbnail_objects WHERE retired_at IS NOT NULL AND checked_at=${at})`,
  ]);
  const claimed = result[0]!.results as { key: string; workspaceId: string; contentId: string }[];
  if (claimed.some((row) => !ownedThumbnailKey(row.key, row.workspaceId, row.contentId))) throw new Error("thumbnail_key_rejected");
  await deleteClaimedThumbnails(env, db, claimed.map((row) => row.key));
}

export async function enqueueThumbnailSweep(env: Env): Promise<void> {
  await env.PIPELINE.sendBatch([{ body: { type: "sweep_content_thumbnails", payload: {} } }]);
}

function imageType(bytes: Uint8Array, declared: string): { type: string; ext: string } | null {
  if (declared === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: declared, ext: "jpg" };
  if (declared === "image/png" && bytes.slice(0, 8).every((b, i) => b === [137, 80, 78, 71, 13, 10, 26, 10][i]) && bytes.length >= 8) return { type: declared, ext: "png" };
  const text = new TextDecoder().decode(bytes.slice(0, 12));
  if (declared === "image/webp" && text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return { type: declared, ext: "webp" };
  if (declared === "image/gif" && /^(GIF87a|GIF89a)/.test(text)) return { type: declared, ext: "gif" };
  return null;
}

async function downloadThumbnail(raw: string): Promise<{ bytes: Uint8Array; type: string; ext: string }> {
  let url = thumbnailSource(raw);
  if (!url) throw new Error("thumbnail_url_rejected");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), THUMBNAIL_TIMEOUT_MS);
  try {
    for (let redirects = 0; redirects <= 2; redirects++) {
      const response: Response = await fetch(url, { signal: controller.signal, redirect: "manual", headers: { Accept: "image/jpeg,image/png,image/webp,image/gif" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location: string | null = response.headers.get("location");
        await response.body?.cancel();
        url = location ? thumbnailSource(new URL(location, url).href) : null;
        if (!url || redirects === 2) throw new Error("thumbnail_redirect_rejected");
        continue;
      }
      const declared = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      const length = Number(response.headers.get("content-length") ?? 0);
      if (!response.ok || !response.body || !/^image\/(jpeg|png|webp|gif)$/.test(declared) || !Number.isInteger(length) || length < 0 || length > THUMBNAIL_MAX_BYTES) {
        await response.body?.cancel();
        throw new Error("thumbnail_response_rejected");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          total += part.value.byteLength;
          if (total > THUMBNAIL_MAX_BYTES) { await reader.cancel(); throw new Error("thumbnail_too_large"); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const format = imageType(bytes, declared);
      if (!format) throw new Error("thumbnail_image_rejected");
      return { bytes, ...format };
    }
    throw new Error("thumbnail_redirect_rejected");
  } finally { clearTimeout(timeout); }
}

// CDN URL은 만료될 수 있으므로 모든 썸네일을 복사한다. 응답에는 인증된 로컬 읽기 주소만 노출한다.
export async function saveContentThumbnail(env: Env, db: Db, workspaceId: string, content: Content, rawUrl: string): Promise<boolean> {
  const source = thumbnailSource(rawUrl);
  if (!source || !TOKEN.test(workspaceId) || !TOKEN.test(content.id)) return false;
  // 원본 URL 기록도 같은 URL 세대/캠페인 범위를 벗어나 쓰지 않는다.
  const recorded = await db.update(contents).set({ thumbnailUrl: source.href })
    .where(and(eq(contents.id, content.id), collectionAllowed(content, workspaceId))).returning({ id: contents.id });
  if (!recorded.length) return false;
  const image = await downloadThumbnail(source.href);
  const key = `content-thumbnails/${workspaceId}/${content.id}/${newId()}.${image.ext}`;
  // put 전에 반드시 영속화한다. 네트워크 응답을 잃거나 Worker가 종료돼도 키를 잃지 않는다.
  await db.run(sql`INSERT INTO content_thumbnail_objects (key,workspace_id,content_id,created_at)
    VALUES (${key},${workspaceId},${content.id},${now()})`);
  try {
    await env.FILES.put(key, image.bytes, { httpMetadata: { contentType: image.type } });
    const changed = await db.update(contents).set({ thumbnailUrl: source.href, thumbnailKey: key, thumbnailFetchedAt: now() })
      .where(and(eq(contents.id, content.id), collectionAllowed(content, workspaceId), sql`EXISTS (
        SELECT 1 FROM content_thumbnail_objects o WHERE o.key=${key} AND o.workspace_id=${workspaceId} AND o.content_id=${content.id} AND o.retired_at IS NULL
      )`)).returning({ id: contents.id });
    if (!changed.length) { await retireThumbnail(env, db, workspaceId, content.id, key); return false; }
    if (content.thumbnailKey) await retireThumbnail(env, db, workspaceId, content.id, content.thumbnailKey);
    return true;
  } catch (error) {
    // CAS 저장 자체가 실패한 경우 새 객체가 현재 키인지 확인한 다음 보상 삭제한다.
    await retireThumbnail(env, db, workspaceId, content.id, key);
    throw error;
  }
}
