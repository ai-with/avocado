import { sha256Hex } from "./ids";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const ACTION = "guide_join" as const;
const ATTEMPT_TIMEOUT = 5_000;
const MAX_RESPONSE_BYTES = 16 * 1024;
const TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
]);
const TEST_SECRET_KEYS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);
const TOKEN_ERRORS = new Set(["missing-input-response", "invalid-input-response", "timeout-or-duplicate"]);

type Verification = "ok" | "invalid" | "unavailable";
type Attempt = Verification | "retry";
type Diagnostic = { reason: "network" | "http" | "body" | "json" | "provider"; status?: number; timeout?: boolean; codes?: string[] };
const DIAGNOSTIC_CODES = new Set([...TOKEN_ERRORS, "missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"]);

function productionHostname(env: Env): string | null {
  const appUrl = env.APP_URL;
  // 설정은 credential·경로·query·fragment 없는 HTTPS origin이어야 한다.
  if (typeof appUrl !== "string" || !/^https:\/\/[^/?#\\@\s]+\/?$/i.test(appUrl)) return null;
  try {
    const url = new URL(appUrl);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url.hostname : null;
  } catch {
    return null;
  }
}

export function turnstileConfigured(env: Env): boolean {
  const { TURNSTILE_SITE_KEY: siteKey, TURNSTILE_SECRET_KEY: secretKey, TOKEN_ENC_KEY: encryptionKey } = env;
  // 앞뒤 공백을 허용하지 않아 공개 sitekey와 서버 secret에 같은 설정값을 쓴다.
  if (!siteKey || siteKey !== siteKey.trim() || !secretKey || secretKey !== secretKey.trim() || !encryptionKey || encryptionKey !== encryptionKey.trim()) return false;
  return env.APP_ENV !== "production" || (!!productionHostname(env) && !TEST_SITE_KEYS.has(siteKey) && !TEST_SECRET_KEYS.has(secretKey));
}

export async function publicJoinChallenge(env: Env, guideId: string): Promise<{ siteKey: string | null; action: typeof ACTION; cData: string }> {
  return {
    siteKey: turnstileConfigured(env) ? env.TURNSTILE_SITE_KEY! : null,
    action: ACTION,
    cData: await sha256Hex(`guide-join:${guideId}`),
  };
}

function validationResult(payload: unknown, hostname: string, cData: string): Attempt {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "unavailable";
  const result = payload as Record<string, unknown>;
  const errors = result["error-codes"];
  if (errors !== undefined && (!Array.isArray(errors) || errors.some((error) => typeof error !== "string"))) return "unavailable";
  if (result.success === true) {
    if (errors !== undefined && errors.length > 0) return "unavailable";
    if (typeof result.hostname !== "string" || typeof result.action !== "string" || typeof result.cdata !== "string") return "unavailable";
    return result.hostname === hostname && result.action === ACTION && result.cdata === cData ? "ok" : "invalid";
  }
  if (result.success !== false || !Array.isArray(errors) || errors.length === 0) return "unavailable";
  if (errors.length === 1 && errors[0] === "internal-error") return "retry";
  return errors.every((error) => TOKEN_ERRORS.has(error)) ? "invalid" : "unavailable";
}

async function readResponseBody(response: Response): Promise<{ body: string } | { failure: "retry" | "unavailable" }> {
  const declared = response.headers.get("Content-Length")?.trim();
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    return { failure: "unavailable" };
  }
  const reader = response.body?.getReader();
  if (!reader) return { failure: "unavailable" };
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        return { failure: "unavailable" };
      }
      chunks.push(value);
    }
  } catch {
    return { failure: "retry" };
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return { body: new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes) };
  } catch {
    return { failure: "unavailable" };
  }
}

async function verifyAttempt(secret: string, token: string, idempotencyKey: string, hostname: string, cData: string, diagnose: (details: Diagnostic) => void): Promise<Attempt> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT);
  try {
    let response: Response;
    try {
      response = await fetch(SITEVERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret, response: token, idempotency_key: idempotencyKey }),
        // Workers supports manual/follow only. Reject the returned 3xx below.
        redirect: "manual",
        signal: controller.signal,
      });
    } catch {
      diagnose({ reason: "network", timeout: controller.signal.aborted });
      return "retry";
    }
    if (!response.ok) {
      diagnose({ reason: "http", status: response.status });
      void response.body?.cancel().catch(() => {});
      return "unavailable";
    }
    const content = await readResponseBody(response);
    if ("failure" in content) { diagnose({ reason: "body" }); return content.failure; }
    let payload: unknown;
    try {
      payload = JSON.parse(content.body);
    } catch {
      diagnose({ reason: "json" });
      return "unavailable";
    }
    const result = validationResult(payload, hostname, cData);
    if (result === "unavailable" || result === "retry") {
      const codes: unknown = payload && typeof payload === "object" ? (payload as Record<string, unknown>)["error-codes"] : null;
      diagnose({ reason: "provider", codes: Array.isArray(codes) ? [...new Set(codes.filter((code): code is string => typeof code === "string" && DIAGNOSTIC_CODES.has(code)))].slice(0, DIAGNOSTIC_CODES.size) : [] });
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyPublicJoin(env: Env, token: string, guideId: string, requestUrl: string): Promise<Verification> {
  if (typeof token !== "string" || token.length < 1 || token.length > 2_048) return "invalid";
  if (!turnstileConfigured(env)) return "unavailable";
  let hostname: string;
  try {
    hostname = new URL(env.APP_ENV === "production" ? env.APP_URL : requestUrl).hostname;
    if (!hostname) return "unavailable";
  } catch {
    return "unavailable";
  }
  const cData = await sha256Hex(`guide-join:${guideId}`);
  const idempotencyKey = crypto.randomUUID();
  let diagnostic: Diagnostic | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await verifyAttempt(env.TURNSTILE_SECRET_KEY!, token, idempotencyKey, hostname, cData, (details) => { diagnostic = details; });
    if (result !== "retry") {
      if (result === "unavailable") console.warn("[turnstile] verification_unavailable", diagnostic);
      return result;
    }
  }
  console.warn("[turnstile] verification_unavailable", diagnostic);
  return "unavailable";
}
