import type { Envelope, SdkEvent } from "../../../shared/sdk-events";
import { decryptToken, encryptToken } from "../crypto";
import { newId } from "../ids";
import { sdkKey } from "./intake";

export const RAW_TTL_MS = 90 * 86_400_000;
export const RAW_WRITE_LEASE_MS = 16 * 60_000; // Beyond Queue's 15 minute invocation lifetime.
export const RAW_CLEANUP_LIMIT = 1000;
export const SDK_DISPATCH_LIMIT = 50;
export const MAX_RAW_BYTES = 256 * 1024; // URL pathname escaping can expand a 64KiB accepted envelope.
const FAILURE = "sdk_raw_write_failed";

// This is the previous AE projection, not a second copy of SDK profiles/props.
export function rawPoint(envelope: Envelope, event: SdkEvent) {
  let path = "";
  try { path = new URL(event.url).pathname; } catch { /* Same behavior as AE. */ }
  const click = event.t === "click" ? event : null;
  return { t: event.t, path, sel: click?.sel ?? (event.t === "form_submit" ? event.sel : event.t === "track" ? event.name : ""),
    clickId: envelope.attr.last?.clickId ?? "", session: envelope.sess, vw: click?.vw ?? "", x: click?.x ?? 0, y: click?.y ?? 0,
    metric: event.t === "scroll" ? event.depth : event.t === "dwell" ? event.ms : event.t === "conversion" ? event.value ?? 0 : 0 };
}

export async function prepareRawBatch(env: Env, siteId: string, workspaceId: string, receivedAt: number, envelope: Envelope, fresh: SdkEvent[]) {
  const id = newId(), payload = JSON.stringify({ v: 1, receivedAt, points: fresh.map((e) => rawPoint(envelope, e)) });
  if (new TextEncoder().encode(payload).byteLength > MAX_RAW_BYTES) throw new Error(FAILURE);
  try {
    const enc = await encryptToken(sdkKey(env), payload);
    return { id, statement: env.DB.prepare(`INSERT INTO site_raw_batches(id,site_id,workspace_id,received_at,expires_at,payload_enc)
      SELECT ?,id,workspace_id,?,?,? FROM sites WHERE id=? AND workspace_id=? AND deleted_at IS NULL`)
      .bind(id, receivedAt, receivedAt + RAW_TTL_MS, enc, siteId, workspaceId) };
  } catch { throw new Error(FAILURE); }
}

async function retireAttempt(env: Env, token: string) {
  // A lost successful publish response must not retire the selected live object.
  await env.DB.prepare(`UPDATE site_raw_objects SET state='retired',deleted_at=NULL WHERE id=? AND NOT EXISTS(
    SELECT 1 FROM site_raw_batches b JOIN sites s ON s.id=b.site_id AND s.deleted_at IS NULL
    WHERE b.id=site_raw_objects.batch_id AND b.status='ready' AND b.object_key=site_raw_objects.key)`)
    .bind(token).run();
  const row = await env.DB.prepare("SELECT key FROM site_raw_objects WHERE id=? AND state='retired'").bind(token).first<{ key: string }>();
  if (row) {
    await env.FILES.delete(row.key);
    await env.DB.prepare("UPDATE site_raw_objects SET deleted_at=?,checked_at=? WHERE id=? AND state='retired'").bind(Date.now(), Date.now(), token).run();
  }
}

export async function processRawBatch(payload: unknown, env: Env): Promise<void> {
  const id = typeof payload === "object" && payload !== null && Object.keys(payload).length === 1 && "id" in payload && typeof payload.id === "string" && payload.id.length > 0 && payload.id.length <= 128 ? payload.id : null;
  if (!id) return;
  const token = newId(), at = Date.now();
  try {
    const state = await env.DB.prepare(`SELECT b.site_id FROM site_raw_batches b JOIN sites s ON s.id=b.site_id AND s.workspace_id=b.workspace_id AND s.deleted_at IS NULL
      WHERE b.id=? AND b.status='pending' AND b.expires_at>? AND b.received_at<=?`).bind(id, at, at).first<{ site_id: string }>();
    if (!state) return;
    const key = `site-events/${state.site_id}/${new Date(at).toISOString().slice(0, 10)}/${id}/${token}.json`;
    await env.DB.batch([
      env.DB.prepare(`UPDATE site_raw_batches AS b SET write_token=?,lease_until=?,next_attempt_at=? WHERE id=? AND status='pending' AND lease_until<=? AND expires_at>?
        AND EXISTS(SELECT 1 FROM sites s WHERE s.id=b.site_id AND s.workspace_id=b.workspace_id AND s.deleted_at IS NULL)`)
        .bind(token, at + RAW_WRITE_LEASE_MS, at + RAW_WRITE_LEASE_MS, id, at, at),
      env.DB.prepare(`UPDATE site_raw_objects SET state='retired' WHERE batch_id=? AND state='writing' AND id<>(SELECT write_token FROM site_raw_batches WHERE id=?)`).bind(id, id),
      env.DB.prepare(`INSERT INTO site_raw_objects(id,batch_id,site_id,key,state,created_at,lease_until)
        SELECT ?,id,site_id,?,'writing',?,? FROM site_raw_batches WHERE id=? AND write_token=? AND status='pending'`)
        .bind(token, key, at, at + RAW_WRITE_LEASE_MS, id, token),
    ]);
    const owned = await env.DB.prepare(`SELECT b.payload_enc FROM site_raw_batches b JOIN sites s ON s.id=b.site_id AND s.workspace_id=b.workspace_id AND s.deleted_at IS NULL
      JOIN site_raw_objects o ON o.id=b.write_token AND o.state='writing' WHERE b.id=? AND b.write_token=? AND b.status='pending' AND b.expires_at>?`)
      .bind(id, token, Date.now()).first<{ payload_enc: string }>();
    if (!owned) return;
    const plain = await decryptToken(sdkKey(env), owned.payload_enc);
    if (new TextEncoder().encode(plain).byteLength > MAX_RAW_BYTES) throw new Error(FAILURE);
    if (!await env.FILES.put(key, plain, { httpMetadata: { contentType: "application/json" } })) throw new Error(FAILURE);
    const finished = Date.now();
    const result = await env.DB.batch([
      env.DB.prepare(`UPDATE site_raw_objects SET state='ready',lease_until=0 WHERE id=? AND state='writing' AND EXISTS(
        SELECT 1 FROM site_raw_batches b JOIN sites s ON s.id=b.site_id AND s.workspace_id=b.workspace_id AND s.deleted_at IS NULL
        WHERE b.id=? AND b.write_token=? AND b.status='pending' AND b.expires_at>?)`).bind(token, id, token, finished),
      env.DB.prepare(`UPDATE site_raw_batches SET status='ready',payload_enc=NULL,object_key=?,write_token=NULL,lease_until=0 WHERE id=? AND write_token=? AND status='pending'
        AND EXISTS(SELECT 1 FROM site_raw_objects o WHERE o.id=? AND o.state='ready')`).bind(key, id, token, token),
    ]);
    if (!result[0]!.meta.changes) await retireAttempt(env, token);
  } catch {
    await retireAttempt(env, token).catch(() => {});
    await env.DB.prepare("UPDATE site_raw_batches SET write_token=NULL,lease_until=0,next_attempt_at=? WHERE id=? AND status='pending' AND write_token=?")
      .bind(Date.now() + 60_000, id, token).run().catch(() => {});
    throw new Error(FAILURE);
  }
}

// Called by the existing isolated site privacy Queue job, not shared cleanup.
export async function maintainSdkStorage(env: Env): Promise<void> {
  const at = Date.now();
  try {
    const swept = await env.DB.batch([
      env.DB.prepare(`DELETE FROM site_collect_intakes WHERE id IN(SELECT i.id FROM site_collect_intakes i WHERE i.expires_at<=? OR NOT EXISTS(
        SELECT 1 FROM sites s WHERE s.id=i.site_id AND s.workspace_id=i.workspace_id AND s.deleted_at IS NULL) ORDER BY i.expires_at,i.id LIMIT 100)`).bind(at + 15 * 60_000),
      env.DB.prepare(`UPDATE site_raw_objects SET state='retired' WHERE id IN(SELECT o.id FROM site_raw_objects o LEFT JOIN site_raw_batches b ON b.id=o.batch_id
        WHERE o.state<>'retired' AND (b.id IS NULL OR b.expires_at<=? OR (o.state='writing' AND o.lease_until<=?)) ORDER BY o.created_at,o.id LIMIT ?)`).bind(at, at, RAW_CLEANUP_LIMIT),
      env.DB.prepare(`DELETE FROM site_raw_batches WHERE id IN(SELECT b.id FROM site_raw_batches b WHERE b.expires_at<=? AND NOT EXISTS(
        SELECT 1 FROM site_raw_objects o WHERE o.batch_id=b.id AND o.state<>'retired') ORDER BY b.expires_at,b.id LIMIT 100)`).bind(at),
    ]);
    const retired = await env.DB.prepare("SELECT id,key FROM site_raw_objects WHERE state='retired' ORDER BY checked_at,id LIMIT ?").bind(RAW_CLEANUP_LIMIT).all<{ id: string; key: string }>();
    if (retired.results.length) {
      await env.FILES.delete(retired.results.map((r) => r.key));
      await env.DB.prepare("UPDATE site_raw_objects SET checked_at=?,deleted_at=? WHERE id IN(SELECT value FROM json_each(?)) AND state='retired'")
        .bind(at, at, JSON.stringify(retired.results.map((r) => r.id))).run();
    }
    const due = await env.DB.batch([
      env.DB.prepare(`UPDATE site_collect_intakes SET next_attempt_at=? WHERE id IN(SELECT i.id FROM site_collect_intakes i JOIN sites s ON s.id=i.site_id AND s.workspace_id=i.workspace_id AND s.deleted_at IS NULL
        WHERE i.next_attempt_at<=? AND i.expires_at>? AND i.received_at<=? ORDER BY i.next_attempt_at,i.id LIMIT ?) RETURNING id`).bind(at + 60_000, at, at, at, SDK_DISPATCH_LIMIT),
      env.DB.prepare(`UPDATE site_raw_batches SET next_attempt_at=? WHERE id IN(SELECT b.id FROM site_raw_batches b JOIN sites s ON s.id=b.site_id AND s.workspace_id=b.workspace_id AND s.deleted_at IS NULL
        WHERE b.status='pending' AND b.next_attempt_at<=? AND b.lease_until<=? AND b.expires_at>? ORDER BY b.next_attempt_at,b.id LIMIT ?) RETURNING id`).bind(at + 60_000, at, at, at, SDK_DISPATCH_LIMIT),
    ]);
    if (due[0]!.results.length) await env.COLLECT.sendBatch((due[0]!.results as { id: string }[]).map(({ id }) => ({ body: { type: "collect", payload: { id } } })));
    if (due[1]!.results.length) await env.PIPELINE.sendBatch((due[1]!.results as { id: string }[]).map(({ id }) => ({ body: { type: "collect_raw", payload: { id } } })));
    if (swept[0]!.meta.changes === 100 || swept[1]!.meta.changes === RAW_CLEANUP_LIMIT || swept[2]!.meta.changes === 100) {
      await env.PIPELINE.sendBatch([{ body: { type: "sdk_storage_maintenance", payload: {} } }]);
    }
    console.log("[sdk_storage_maintenance]", JSON.stringify({ intake_deleted: swept[0]!.meta.changes, raw_retired: swept[1]!.meta.changes, raw_expired: swept[2]!.meta.changes,
      retired_keys_checked: retired.results.length, intake_queued: due[0]!.results.length, raw_queued: due[1]!.results.length, failures: 0 }));
  } catch {
    console.error("[sdk_storage_maintenance_failed]", JSON.stringify({ failures: 1 }));
    throw new Error("sdk_storage_maintenance_failed");
  }
}
