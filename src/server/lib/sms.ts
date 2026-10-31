import { maskPhone, toKrLocal } from "./phone";
import { sha256Hex } from "./ids";

export type SmsResult = { delivered: true } | { delivered: false; reason: "no_provider" | "provider_error" };

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// Solapi(CoolSMS) v4. 설정이 없으면 로그만 남긴다
export async function sendSms(env: Env, to: string, text: string): Promise<SmsResult> {
  if (env.SMS_PROVIDER !== "solapi" || !env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET || !env.SMS_FROM) {
    // 운영 로그에 인증번호가 남지 않도록 본문은 개발 환경에서만 기록한다
    const logged = env.APP_ENV === "production" ? { to: maskPhone(to) } : { to: maskPhone(to), text };
    console.log("[sms:no_provider]", JSON.stringify(logged));
    return { delivered: false, reason: "no_provider" };
  }
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SOLAPI_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(date + salt)));
  // ponytail: 국내 번호 기준. 해외 번호 발송은 message.country 지정이 필요하다
  const res = await fetch("https://api.solapi.com/messages/v4/send-many/detail", {
    method: "POST",
    headers: {
      Authorization: `HMAC-SHA256 apiKey=${env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages: [{ to: toKrLocal(to), from: env.SMS_FROM.replace(/\D/g, ""), text }] }),
  });
  return judgeResponse(res, to, env.SOLAPI_API_KEY);
}

type SolapiFailure = { statusCode?: string; statusMessage?: string };

// HTTP 오류 본문에서 원인(errorCode, errorMessage)만 꺼낸다. JSON이 아니면 null
async function errorDetail(res: Response): Promise<{ errorCode?: string; errorMessage?: string } | null> {
  try {
    const { errorCode, errorMessage } = (await res.json()) as { errorCode?: string; errorMessage?: string };
    return { errorCode, errorMessage };
  } catch {
    return null;
  }
}

// HTTP 200이어도 failedMessageList가 비어 있지 않으면 발송 실패다
async function judgeResponse(res: Response, to: string, apiKey: string): Promise<SmsResult> {
  const fail = async (detail: unknown) => {
    const key_fingerprint = (await sha256Hex(apiKey)).slice(0, 12);
    console.error("[sms:provider_error]", JSON.stringify({ to: maskPhone(to), status: res.status, detail, key_fingerprint }));
    return { delivered: false, reason: "provider_error" } as const;
  };
  if (!res.ok) return fail(await errorDetail(res));
  let body: { failedMessageList?: SolapiFailure[] };
  try {
    body = await res.json();
  } catch {
    return fail("invalid_json");
  }
  const failed = body.failedMessageList;
  if (Array.isArray(failed) && failed.length > 0) return fail(failed.map((f) => ({ statusCode: f.statusCode, statusMessage: f.statusMessage })));
  return { delivered: true };
}
