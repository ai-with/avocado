import { z } from "zod";

const TOLERANCE_S = 5 * 60;
const SEND_RECORD_WAIT_MS = 10 * 60 * 1000;
type SignatureHeaders = { id: string | undefined; timestamp: string | undefined; signature: string | undefined };
const decode = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

// Svix: https://docs.svix.com/receiving/verifying-payloads/how-manual
// JSON으로 바꾸기 전 원문을 id.timestamp.body 형식으로 검증한다.
export async function verifyResendSignature(secret: string, raw: string, headers: SignatureHeaders, at = Date.now()): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp) || !secret.startsWith("whsec_")) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(at / 1000 - seconds) > TOLERANCE_S) return false;
  try {
    const key = await crypto.subtle.importKey("raw", decode(secret.slice(6)), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${id}.${timestamp}.${raw}`);
    for (const item of signature.split(/\s+/)) {
      const [version, value] = item.split(",");
      if (version !== "v1" || !value) continue;
      try {
        // Web Crypto의 상수 시간 검증을 쓴다.
        if (await crypto.subtle.verify("HMAC", key, decode(value), signed)) return true;
      } catch { /* 키 교체 중인 다른 서명도 확인한다 */ }
    }
  } catch { /* 잘못된 설정이나 Base64도 거절한다 */ }
  return false;
}

export const bounceSchema = z.object({
  type: z.literal("email.bounced"),
  created_at: z.iso.datetime({ offset: true }),
  data: z.object({
    email_id: z.string().min(1).max(200),
    to: z.array(z.email()).min(1).max(100),
    tags: z.record(z.string(), z.string()).optional(),
  }),
});
type Bounce = z.infer<typeof bounceSchema>;
type SentLog = { id: string; workspace_id: string; lead_id: string | null; recipient_email: string | null; lead_created_at: number | null };
const normalizeEmail = (email: string) => email.trim().toLowerCase();

// 이메일 주소만으로 연결하지 않는다. 실제 Resend ID와 발송 기록에 있는 수신자만 대상이다.
export async function recordEmailBounce(d1: D1Database, event: Bounce): Promise<"recorded" | "ignored" | "retry"> {
  const found = await d1.prepare("SELECT id, workspace_id, lead_id, recipient_email, lead_created_at FROM message_logs WHERE provider_id = ? AND channel = 'email' AND status IN ('sent', 'bounced')").bind(event.data.email_id).all<SentLog>();
  if (!found.results.length) {
    // API 응답보다 반송이 먼저 오면 잠시 재시도한다. 삭제로 로그가 사라진 경우 무한 재시도하지 않는다.
    // 초대 등 관리 대상이 아닌 메일과 연결할 수 없는 과거 반송은 주소만으로 추정하지 않는다.
    const age = Date.now() - Date.parse(event.created_at);
    return event.data.tags?.message_log_id && age >= -TOLERANCE_S * 1000 && age < SEND_RECORD_WAIT_MS ? "retry" : "ignored";
  }
  const recipients = new Set(event.data.to.map(normalizeEmail));
  const matching = found.results.filter((row) => row.recipient_email && recipients.has(normalizeEmail(row.recipient_email)));
  const bouncedAt = Date.parse(event.created_at);
  const updates: D1PreparedStatement[] = [];
  for (const row of matching) {
    if (row.lead_id && row.lead_created_at !== null) {
      updates.push(d1.prepare(`UPDATE leads SET bounced_at = ?
        WHERE id = ? AND workspace_id = ? AND lower(trim(email)) = ? AND created_at = ? AND deleted_at IS NULL
        AND (bounced_at IS NULL OR bounced_at > ?)`)
        .bind(bouncedAt, row.lead_id, row.workspace_id, normalizeEmail(row.recipient_email!), row.lead_created_at, bouncedAt));
    }
    updates.push(d1.prepare("UPDATE message_logs SET status = 'bounced', reason = 'bounced' WHERE id = ? AND provider_id = ? AND channel = 'email' AND status = 'sent'").bind(row.id, event.data.email_id));
  }
  // 완료 전에 2xx를 보내지 않는다. DB 실패는 배치 전체를 롤백하고 Svix가 재시도하게 한다.
  if (updates.length) await d1.batch(updates);
  return matching.length ? "recorded" : "ignored";
}
