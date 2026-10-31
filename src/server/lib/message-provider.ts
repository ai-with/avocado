import { messageConfigured, MESSAGE_RETRY } from "./message-delivery-common";

export type QueuedEmailResult = { kind: "accepted"; id: string } | { kind: "retry"; code: string; retryAt?: number; definitiveRejection?: true } | { kind: "uncertain" | "rejected" | "conflict"; code: string; retryAt?: number };
export type QueuedEmailProvider = (env: Env, body: string, deliveryId: string) => Promise<QueuedEmailResult>;
const errorCodes = new Set(["concurrent_idempotent_requests", "invalid_idempotent_request", "rate_limit_exceeded", "daily_quota_exceeded", "monthly_quota_exceeded", "validation_error", "restricted_api_key", "missing_api_key", "suspended_api_key", "application_error", "service_unavailable"]);
async function boundedJson(response: Response): Promise<Record<string, unknown> | null> {
  const reader = response.body?.getReader(); if (!reader) return null;
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 16_384) { await reader.cancel(); return null; } parts.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes)); return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch { return null; } finally { reader.releaseLock(); }
}
export const sendQueuedEmail: QueuedEmailProvider = async (env, body, deliveryId) => {
  if (!messageConfigured(env)) return { kind: "rejected", code: "no_provider" };
  let response: Response;
  try { response = await fetch("https://api.resend.com/emails", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": "message/" + deliveryId }, body }); }
  catch { return { kind: "uncertain", code: "provider_unconfirmed" }; }
  const value = await boundedJson(response);
  if (response.ok) return typeof value?.id === "string" && value.id.trim() && value.id.length <= 200 ? { kind: "accepted", id: value.id } : { kind: "uncertain", code: "provider_response_invalid" };
  const raw = typeof value?.name === "string" ? value.name : typeof value?.code === "string" ? value.code : "";
  const code = errorCodes.has(raw) ? raw : "provider_error";
  if (response.status === 409 && code === "invalid_idempotent_request") return { kind: "conflict", code };
  if (response.status === 409 && code === "concurrent_idempotent_requests") return { kind: "retry", code, retryAt: Date.now() + MESSAGE_RETRY };
  if (response.status === 409) return { kind: "uncertain", code };
  if (response.status === 429) {
    const after = response.headers.get("Retry-After") ?? "", seconds = Number(after);
    const retryAt = after && Number.isFinite(seconds) && seconds >= 0 ? Date.now() + Math.min(86_400_000, seconds * 1000) : Date.parse(after);
    return { kind: "retry", code, definitiveRejection: true, retryAt: Number.isFinite(retryAt) && retryAt > Date.now() ? retryAt : Date.now() + MESSAGE_RETRY };
  }
  if (response.status >= 500 || response.status >= 300 && response.status < 400) return { kind: "uncertain", code };
  return { kind: "rejected", code };
};
