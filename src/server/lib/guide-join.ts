import { z } from "zod";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { ApiError, parse } from "./errors";
import { hmacHex } from "./crypto";
import { newId, now } from "./ids";
import { issueTokens } from "./guides";
import { turnstileConfigured, verifyPublicJoin } from "./turnstile";

export { publicJoinChallenge } from "./turnstile";
export const PUBLIC_JOIN_MAX_BYTES = 8 * 1024;
export const PUBLIC_JOIN_WINDOW_MS = 60_000;
export const PUBLIC_JOIN_IP_LIMIT = 30;
export const PUBLIC_JOIN_GUIDE_LIMIT = 300;
const LIMIT_RETENTION_MS = 15 * 60_000;
const bodySchema = z.object({
  displayName: z.string().trim().min(1, "이름을 입력해 주세요.").max(60),
  igHandle: z.string().trim().max(60).default(""),
  email: z.union([z.literal(""), z.email("이메일 형식이 아니에요.")]).default(""),
  lang: z.enum(["ko", "en"]).default("ko"),
  turnstileToken: z.string().min(1).max(2048),
}).strict();

const unavailable = () => new ApiError(503, "join_unavailable", "지금은 참여를 시작할 수 없어요. 잠시 후 다시 시도해 주세요.", { _: "지금은 참여를 시작할 수 없어요. 잠시 후 다시 시도해 주세요." });
const tooLarge = () => new ApiError(413, "request_too_large", "입력 내용이 너무 커요. 내용을 줄여 다시 시도해 주세요.", { _: "입력 내용이 너무 커요. 내용을 줄여 다시 시도해 주세요." });
const invalidJson = () => new ApiError(400, "invalid_json", "입력 내용을 확인하고 다시 시도해 주세요.", { _: "입력 내용을 확인하고 다시 시도해 주세요." });

// 공용 join만 익명으로 처리한다. 비슷한 URL·다른 메서드·다른 공개 API에는 적용하지 않는다.
export const isPublicGuideJoinRequest = (method: string, path: string) => method === "POST" && /^\/api\/public\/guide\/[^/]+\/join$/.test(path);

// Content-Length를 신뢰하지 않고 실제로 읽은 바이트에 상한을 건다. 초과 뒤에는 더 읽지 않는다.
async function readJoinBody(request: Request) {
  const declared = request.headers.get("Content-Length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > PUBLIC_JOIN_MAX_BYTES) {
    void request.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw invalidJson();
  const reader = request.body?.getReader();
  if (!reader) throw invalidJson();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > PUBLIC_JOIN_MAX_BYTES) {
        void reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const token = (raw as Record<string, unknown>).turnstileToken;
      if (typeof token !== "string" || !token.trim() || token.length > 2048) throw new ApiError(400, "turnstile_required", "보안 확인을 마친 뒤 다시 시도해 주세요.", { _: "보안 확인을 마친 뒤 다시 시도해 주세요." });
    }
    return parse(bodySchema, raw);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalidJson();
  } finally { reader.releaseLock(); }
}

function clientAddress(c: Context<AppEnv>): string {
  const raw = c.req.header("CF-Connecting-IP")?.trim() ?? (c.env.APP_ENV === "production" ? "" : "127.0.0.1");
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(raw) && raw.split(".").every((part) => Number(part) <= 255)) return raw.split(".").map(Number).join(".");
  if (raw.length <= 45 && raw.includes(":") && /^[0-9a-fA-F:.]+$/.test(raw)) {
    try { return new URL(`http://[${raw}]/`).hostname.toLowerCase(); } catch { /* 잘못된 IPv6는 거절한다. */ }
  }
  throw unavailable();
}

async function reserveAttempt(env: Env, key: string, limit: number, expiresAt: number): Promise<boolean> {
  const result = await env.DB.prepare(`INSERT INTO public_join_limits (key,hits,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET hits=hits+1 WHERE hits<? RETURNING hits`).bind(key, expiresAt, limit).all<{ hits: number }>();
  return result.results.length === 1;
}

function rateLimited(c: Context<AppEnv>, end: number): never {
  c.header("Retry-After", String(Math.max(1, Math.ceil((end - now()) / 1000))));
  throw new ApiError(429, "join_rate_limited", "요청이 너무 잦아요. 잠시 기다렸다가 다시 시도해 주세요.", { _: "요청이 너무 잦아요. 잠시 기다렸다가 다시 시도해 주세요." });
}

type Guide = { id: string; workspace_id: string };
async function createPersonalGuide(env: Env, guide: Guide, slug: string, body: z.infer<typeof bodySchema>) {
  const influencerId = newId(), giId = newId(), at = now(), tokens = issueTokens();
  // 최종 가이드 상태·개인 링크·이벤트를 한 트랜잭션으로 저장한다. 0행은 성공으로 취급하지 않는다.
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO influencers (id,workspace_id,display_name,ig_handle,email,lang,created_at)
      SELECT ?,workspace_id,?,?,?,?,? FROM guides WHERE id=? AND workspace_id=? AND slug=? AND status='published'`)
      .bind(influencerId, body.displayName, body.igHandle.replace(/^@/, "") || null, body.email || null, body.lang, at, guide.id, guide.workspace_id, slug),
    env.DB.prepare(`INSERT INTO guide_influencers (id,guide_id,influencer_id,guide_token,upload_token,feedback_token,connect_token,token_expires_at,stage,created_at)
      SELECT ?,g.id,?,?,?,?,?,?,'invited',? FROM guides g JOIN influencers i ON i.id=? AND i.workspace_id=g.workspace_id
      WHERE g.id=? AND g.workspace_id=? AND g.slug=? AND g.status='published'`)
      .bind(giId, influencerId, tokens.guideToken, tokens.uploadToken, tokens.feedbackToken, tokens.connectToken, tokens.tokenExpiresAt, at, influencerId, guide.id, guide.workspace_id, slug),
    env.DB.prepare(`INSERT INTO events (id,workspace_id,name,props,at)
      SELECT ?,?,'guide_link_issued',?,? WHERE EXISTS(SELECT 1 FROM guide_influencers WHERE id=? AND guide_id=? AND influencer_id=?)`)
      .bind(newId(), guide.workspace_id, JSON.stringify({ guide_id: guide.id }), at, giId, guide.id, influencerId),
  ]);
  if (result.every((statement) => statement.meta.changes === 0)) throw new ApiError(404, "link_not_found", "링크를 찾을 수 없어요.");
  if (!result.every((statement) => statement.meta.changes === 1)) throw new Error("public_join_write_incomplete");
  return { guideToken: tokens.guideToken };
}

export async function joinPublicGuide(c: Context<AppEnv>, slug: string): Promise<{ guideToken: string }> {
  try {
    const body = await readJoinBody(c.req.raw);
    if (!turnstileConfigured(c.env)) throw unavailable();
    const ip = clientAddress(c);
    const guide = await c.env.DB.prepare("SELECT id,workspace_id FROM guides WHERE slug=? AND status='published'").bind(slug).first<Guide>();
    if (!guide) throw new ApiError(404, "link_not_found", "링크를 찾을 수 없어요.");
    const window = Math.floor(now() / PUBLIC_JOIN_WINDOW_MS), end = (window + 1) * PUBLIC_JOIN_WINDOW_MS, expiry = end + LIMIT_RETENTION_MS;
    const ipKey = `ip:${window}:${await hmacHex(c.env.TOKEN_ENC_KEY!, `public-guide-join:ip:${window}:${ip}`)}`;
    if (!await reserveAttempt(c.env, ipKey, PUBLIC_JOIN_IP_LIMIT, expiry)) rateLimited(c, end);
    const guideKey = `guide:${window}:${await hmacHex(c.env.TOKEN_ENC_KEY!, `public-guide-join:guide:${window}:${guide.id}`)}`;
    if (!await reserveAttempt(c.env, guideKey, PUBLIC_JOIN_GUIDE_LIMIT, expiry)) rateLimited(c, end);
    const verified = await verifyPublicJoin(c.env, body.turnstileToken, guide.id, c.req.url);
    if (verified === "invalid") throw new ApiError(403, "turnstile_failed", "보안 확인이 만료됐거나 완료되지 않았어요. 다시 확인해 주세요.", { _: "보안 확인이 만료됐거나 완료되지 않았어요. 다시 확인해 주세요." });
    if (verified !== "ok") throw new ApiError(503, "turnstile_unavailable", "보안 확인에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.", { _: "보안 확인에 연결하지 못했어요. 잠시 후 다시 시도해 주세요." });
    return await createPersonalGuide(c.env, guide, slug, body);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("[public_join_failed]", JSON.stringify({ failures: 1 }));
    throw unavailable(); // DB bound params의 연락처·capability·IP fingerprint 원문/cause를 기록하지 않는다.
  }
}

// 새 Cron 쿼리를 추가하지 않고 기존 cleanup Queue에서 호출한다. 실패는 Queue retry로 전파한다.
export async function cleanupPublicJoinLimits(env: Env): Promise<void> {
  try {
    const result = await env.DB.prepare(`DELETE FROM public_join_limits WHERE key IN
      (SELECT key FROM public_join_limits WHERE expires_at<=? ORDER BY expires_at,key LIMIT 1000)`).bind(now()).run();
    console.log("[public_join_limits_cleanup]", JSON.stringify({ deleted: result.meta.changes, failures: 0 }));
  } catch {
    console.error("[public_join_limits_cleanup_failed]", JSON.stringify({ failures: 1 }));
    throw new Error("public_join_limits_cleanup_failed");
  }
}
