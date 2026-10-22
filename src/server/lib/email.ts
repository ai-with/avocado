export type EmailMessage = { to: string; subject: string; html: string; text: string };
export type EmailResult = { delivered: true; id: string } | { delivered: false; reason: "no_provider" | "provider_error" };

export async function sendEmail(env: Env, msg: EmailMessage): Promise<EmailResult> {
  const from = env.EMAIL_FROM || "no-reply@example.com";
  if (!env.RESEND_API_KEY) {
    console.log("[email:no_provider]", JSON.stringify({ from, ...msg }));
    return { delivered: false, reason: "no_provider" };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!res.ok) {
    console.error("[email:provider_error]", res.status, await res.text());
    return { delivered: false, reason: "provider_error" };
  }
  const data: { id: string } = await res.json();
  return { delivered: true, id: data.id };
}
