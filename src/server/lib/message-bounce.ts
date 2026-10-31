import { messageRecipientHmac, MESSAGE_DAY } from "./message-delivery-common";

export type ManagedBounce = { created_at: string; data: { email_id: string; to: string[]; tags?: Record<string, string> } };
// Called only after the existing Svix signature/schema validation. A tag alone
// never changes a lead: provider ID is bound by the accepted response first.
export async function holdManagedBounce(db: D1Database, event: ManagedBounce, key?: string): Promise<boolean> {
  const id = event.data.tags?.message_log_id;
  if (!key || !id || id.length > 100) return false;
  try {
    const at = Date.now(), bouncedAt = Date.parse(event.created_at);
    const current = await db.prepare(`SELECT d.recipient_hmac,d.first_http_at FROM message_deliveries d JOIN leads l ON l.id=d.lead_id AND l.workspace_id=d.workspace_id JOIN lead_import_births b ON b.lead_id=l.id AND b.workspace_id=l.workspace_id
      WHERE d.id=? AND d.recipient_hmac IS NOT NULL AND d.first_http_at IS NOT NULL AND d.first_http_at>? AND l.deleted_at IS NULL AND l.created_at=d.lead_created_at AND b.revision=d.lead_birth_revision`)
      .bind(id, at - MESSAGE_DAY).first<{ recipient_hmac: string; first_http_at: number }>();
    if (!current || !Number.isFinite(bouncedAt) || bouncedAt < current.first_http_at - 300_000 || bouncedAt > at + 300_000) return false;
    const hmacs = await Promise.all(event.data.to.map((email) => messageRecipientHmac(key, id, email)));
    if (!hmacs.includes(current.recipient_hmac)) return false;
    const result = await db.prepare(`INSERT INTO email_bounce_pending(provider_id,delivery_id,recipient_hmac,bounced_at,expires_at)
      SELECT ?,id,recipient_hmac,?,? FROM message_deliveries WHERE id=? AND recipient_hmac=? AND first_http_at=? AND lead_id IN(SELECT id FROM leads WHERE deleted_at IS NULL)
      ON CONFLICT(provider_id,delivery_id,recipient_hmac) DO UPDATE SET bounced_at=min(bounced_at,excluded.bounced_at)`)
      .bind(event.data.email_id, bouncedAt, current.first_http_at + MESSAGE_DAY, id, current.recipient_hmac, current.first_http_at).run();
    return result.meta.changes > 0;
  } catch { throw new Error("managed_bounce_unavailable"); }
}
export function pendingBounceStatements(db: D1Database, deliveryId: string, providerId: string, recipientHmac: string) {
  return [db.prepare(`UPDATE leads AS l SET bounced_at=(SELECT min(p.bounced_at) FROM email_bounce_pending p WHERE p.delivery_id=? AND p.provider_id=? AND p.recipient_hmac=?)
    WHERE l.id=(SELECT lead_id FROM message_deliveries WHERE id=?) AND EXISTS(SELECT 1 FROM message_deliveries d JOIN lead_import_births b ON b.lead_id=d.lead_id AND b.workspace_id=d.workspace_id
      JOIN message_delivery_receipts receipt ON receipt.delivery_id=d.id AND receipt.status='accepted' AND receipt.provider_id=?
      WHERE d.id=? AND b.revision=d.lead_birth_revision AND l.workspace_id=d.workspace_id AND l.created_at=d.lead_created_at AND l.deleted_at IS NULL)
    AND EXISTS(SELECT 1 FROM email_bounce_pending p WHERE p.delivery_id=? AND p.provider_id=? AND p.recipient_hmac=? AND (l.bounced_at IS NULL OR l.bounced_at>p.bounced_at))`)
    .bind(deliveryId, providerId, recipientHmac, deliveryId, providerId, deliveryId, deliveryId, providerId, recipientHmac)];
}
