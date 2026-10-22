import { toKrLocal } from "./phone";

export type SmsResult = { delivered: true } | { delivered: false; reason: "no_provider" | "provider_error" };

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// Solapi(CoolSMS) v4. 설정이 없으면 로그만 남긴다
export async function sendSms(env: Env, to: string, text: string): Promise<SmsResult> {
  if (env.SMS_PROVIDER !== "solapi" || !env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET || !env.SMS_FROM) {
    console.log("[sms:no_provider]", JSON.stringify({ to, text }));
    return { delivered: false, reason: "no_provider" };
  }
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SOLAPI_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(date + salt)));
  // ponytail: 국내 번호 기준. 해외 번호 발송은 message.country 지정이 필요하다
  const res = await fetch("https://api.solapi.com/messages/v4/send", {
    method: "POST",
    headers: {
      Authorization: `HMAC-SHA256 apiKey=${env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: { to: toKrLocal(to), from: env.SMS_FROM.replace(/\D/g, ""), text } }),
  });
  if (!res.ok) {
    console.error("[sms:provider_error]", res.status, await res.text());
    return { delivered: false, reason: "provider_error" };
  }
  return { delivered: true };
}
