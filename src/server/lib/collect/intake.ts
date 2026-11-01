import { z } from "zod";
import { decryptToken, encryptToken } from "../crypto";
import { newId } from "../ids";
import type { CollectMessage } from "./consume";
import { envelopeSchema, MAX_BODY_BYTES } from "./schema";

export const INTAKE_TTL_MS = 86_400_000;
export const sdkKey = (env: Env) => {
  if (!env.TOKEN_ENC_KEY || env.TOKEN_ENC_KEY !== env.TOKEN_ENC_KEY.trim()) throw new Error("sdk_storage_failed");
  return env.TOKEN_ENC_KEY;
};
const reference = z.object({ id: z.string().min(1).max(128) }).strict();
const messageSchema = z.object({ siteId: z.string().min(1).max(128), workspaceId: z.string().min(1).max(128), receivedAt: z.number().int().nonnegative(), country: z.string().max(10).nullable(), device: z.string().max(30), envelope: envelopeSchema }).strict();
export const currentIntake = (receivedAt: number, at = Date.now()) => receivedAt <= at && receivedAt > at - INTAKE_TTL_MS;

export async function stageCollectIntake(env: Env, message: CollectMessage): Promise<string | null> {
  try {
    const id = newId(), at = Date.now();
    if (!currentIntake(message.receivedAt, at)) return null;
    const payload = await encryptToken(sdkKey(env), JSON.stringify(message));
    const accepted = await env.DB.prepare(`INSERT INTO site_collect_intakes(id,site_id,workspace_id,received_at,expires_at,payload_enc,next_attempt_at)
      SELECT ?,id,workspace_id,?,?,?,? FROM sites WHERE id=? AND workspace_id=? AND deleted_at IS NULL AND ?>? RETURNING id`)
      .bind(id, message.receivedAt, message.receivedAt + INTAKE_TTL_MS, payload, at + 60_000, message.siteId, message.workspaceId, message.receivedAt + INTAKE_TTL_MS, Date.now()).first<{ id: string }>();
    return accepted?.id ?? null;
  } catch { throw new Error("sdk_intake_failed"); }
}

// Legacy messages are accepted only during their original 24h collection window.
// No exception from parsing/decryption or SQL may expose SDK/contact fields.
export async function loadCollectMessage(env: Env, payload: unknown): Promise<CollectMessage | null> {
  try {
    const ref = reference.safeParse(payload);
    if (ref.success) {
      const at = Date.now();
      const row = await env.DB.prepare(`SELECT i.site_id,i.workspace_id,i.received_at,i.payload_enc FROM site_collect_intakes i
        JOIN sites s ON s.id=i.site_id AND s.workspace_id=i.workspace_id AND s.deleted_at IS NULL
        WHERE i.id=? AND i.received_at<=? AND i.expires_at>?`).bind(ref.data.id, at, at).first<{ site_id: string; workspace_id: string; received_at: number; payload_enc: string }>();
      if (!row) return null;
      const parsed = messageSchema.safeParse(JSON.parse(await decryptToken(sdkKey(env), row.payload_enc)));
      if (!parsed.success || parsed.data.siteId !== row.site_id || parsed.data.workspaceId !== row.workspace_id || parsed.data.receivedAt !== row.received_at || !currentIntake(parsed.data.receivedAt)) throw new Error("invalid_intake");
      return { ...parsed.data, intakeId: ref.data.id };
    }
    // Old queue payloads were bounded by /collect before enqueue. Reject forged
    // or oversized old messages rather than copying them into durable storage.
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_BODY_BYTES + 4096) return null;
    const parsed = messageSchema.safeParse(payload);
    return parsed.success && currentIntake(parsed.data.receivedAt) ? parsed.data : null;
  } catch { throw new Error("sdk_intake_failed"); }
}
