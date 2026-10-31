export type EmailMessage = { to: string; subject: string; html: string; text: string; tags?: { name: string; value: string }[] };
export type EmailResult = { delivered: true; id: string } | { delivered: false; reason: "no_provider" | "provider_error" };
export type EmailSendOptions = { idempotencyKey?: string; timeoutMs?: number; logProviderErrors?: boolean; from?: string };

export async function sendEmail(env: Env, msg: EmailMessage, options: EmailSendOptions = {}): Promise<EmailResult> {
  const from = options.from ?? (env.EMAIL_FROM || "no-reply@example.com");
  if (!env.RESEND_API_KEY) {
    if (options.logProviderErrors !== false) console.log("[email:no_provider]", JSON.stringify({ from, ...msg }));
    return { delivered: false, reason: "no_provider" };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", ...(options.idempotencyKey && { "Idempotency-Key": options.idempotencyKey }) },
    ...(options.timeoutMs && { signal: AbortSignal.timeout(options.timeoutMs) }),
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, ...(msg.tags?.length && { tags: msg.tags }) }),
  });
  if (!res.ok) {
    if (options.logProviderErrors !== false) console.error("[email:provider_error]", res.status, await res.text());
    else await res.body?.cancel();
    return { delivered: false, reason: "provider_error" };
  }
  const data: { id?: unknown } = await res.json();
  if (typeof data.id !== "string" || !data.id.trim()) {
    if (options.logProviderErrors !== false) console.error("[email:provider_error]", "missing_email_id");
    return { delivered: false, reason: "provider_error" };
  }
  return { delivered: true, id: data.id };
}
