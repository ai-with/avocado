// 인스타그램 Graph API 어댑터 (v26.0). SDK 없이 fetch 만 쓴다.
// 인스타그램 로그인 경로: graph.instagram.com / 미연결 경로(business_discovery): graph.facebook.com (페이스북 로그인 경로 기능, C5)
// IG_FAKE=1 이면 네트워크 없이 고정 응답을 돌려준다 (로컬 흐름 확인용)
import { IG_SCOPES, parsePostUrl, type Metric, type MissingReason } from "../../shared/performance";
import { hmacHex, safeEqual } from "./crypto";

const V = "v26.0";
const IG = `https://graph.instagram.com/${V}`;
const FB = `https://graph.facebook.com/${V}`;

export type IgFail = { ok: false; reason: MissingReason | "not_configured" | "grant_unverified" | "invalid_response" | "personal_account"; code?: number; message?: string; transient?: boolean; authFailure?: boolean };
export type IgResult<T> = { ok: true; data: T } | IgFail;

export const isFake = (env: Env) => env.IG_FAKE === "1";
// 토큰 암호화 키. 가짜 모드에서만 키 없이 고정값을 쓴다
export const tokenKey = (env: Env): string | null => env.TOKEN_ENC_KEY || (isFake(env) ? "ig-fake-key" : null);
// 연결(OAuth) 가능 여부. 앱 설정이 없으면 공개 연결 화면은 '연결 준비 중'
export const igConfigured = (env: Env) => isFake(env) || Boolean(env.META_APP_ID && env.META_APP_SECRET && env.TOKEN_ENC_KEY);
export const redirectUri = (env: Env) => `${env.APP_URL}/api/ig/oauth/callback`;

type GraphError = { error?: { code?: number; error_subcode?: number; message?: string; is_transient?: boolean } };

// Graph 오류 코드 → 사유. 190 토큰 무효, 100/33 객체 없음(삭제), 110 계정 없음
export function classifyIgFailure(status: number, body: GraphError): IgFail {
  const code = body.error?.code;
  const sub = body.error?.error_subcode;
  const message = body.error?.message ?? `HTTP ${status}`;
  const transient = status === 429 || status >= 500 || body.error?.is_transient === true;
  if (transient) return { ok: false, reason: "api_error", code, message, transient: true };
  // 190은 만료·철회·무효의 공통 인증 실패다. 미검증 subcode로 세부 원인을 추정하지 않는다.
  if (code === 190) return { ok: false, reason: "token_expired", code, message, transient: false, authFailure: true };
  if (code === 100 && sub === 33) return { ok: false, reason: "deleted", code, message };
  if (code === 110 || (code === 100 && /business_discovery|cannot find|not found/i.test(message))) return { ok: false, reason: "private_or_unavailable", code, message };
  if (code === 10 || code === 200) return { ok: false, reason: "not_supported", code, message };
  return { ok: false, reason: "api_error", code, message };
}

async function call<T>(url: string, init?: RequestInit): Promise<IgResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, { ...init, signal: init?.signal ?? controller.signal });
    const body = (await res.json().catch(() => ({}))) as T & GraphError;
    if (!res.ok || body.error) return classifyIgFailure(res.status, body);
    return { ok: true, data: body };
  } catch {
    // 네트워크 오류의 URL에 access_token이 포함될 수 있어 원문 오류를 반환하지 않는다.
    return { ok: false, reason: "api_error", message: "provider_request_failed", transient: true };
  } finally { clearTimeout(timeout); }
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

// --- OAuth (인스타그램 로그인) ---
export function authorizeUrl(env: Env, state: string, scopes: string[]): string {
  if (isFake(env)) return `${redirectUri(env)}?${q({ code: "fake", state })}`;
  return `https://www.instagram.com/oauth/authorize?${q({ enable_fb_login: "0", client_id: env.META_APP_ID!, redirect_uri: redirectUri(env), response_type: "code", scope: scopes.join(","), state })}`;
}

export type IgAccount = { token: string; expiresAt: number; igUserId: string; username: string; accountType: string; grantedScopes: string[] };

const opaqueToken = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 16_384 && !/\s/.test(value);
const providerId = (value: unknown): string | null => typeof value === "string" && /^\d{1,30}$/.test(value) ? value : typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
function explicitScopes(value: Record<string, unknown>): string[] | null {
  const parsed = [typeof value.scope === "string" ? value.scope.trim().split(/\s+/) : null, Array.isArray(value.permissions) ? value.permissions : null].filter((item): item is unknown[] => item !== null);
  if (!parsed.length || parsed.some((scopes) => !scopes.length || scopes.length > 32 || scopes.some((scope) => typeof scope !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(scope)))) return null;
  const scopes = parsed.map((items) => [...new Set(items as string[])].sort());
  return scopes.length === 2 && JSON.stringify(scopes[0]) !== JSON.stringify(scopes[1]) ? null : scopes[0]!;
}

// 코드 → 단기 토큰 → 장기 토큰(60일) → 계정 정보
export async function exchangeCode(env: Env, code: string, expectedFakeScopes?: string[]): Promise<IgResult<IgAccount>> {
  if (isFake(env)) {
    const n = Math.floor(Math.random() * 100000);
    return { ok: true, data: { token: `fake-token-${n}`, expiresAt: Date.now() + 60 * 86_400_000, igUserId: `fake_${n}`, username: `fake_account_${n}`, accountType: "BUSINESS", grantedScopes: [...new Set(expectedFakeScopes ?? Object.values(IG_SCOPES).flat())].sort() } };
  }
  const short = await call<Record<string, unknown>>("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({ client_id: env.META_APP_ID!, client_secret: env.META_APP_SECRET!, grant_type: "authorization_code", redirect_uri: redirectUri(env), code }),
  });
  if (!short.ok) return short;
  if (!opaqueToken(short.data.access_token) || !providerId(short.data.user_id)) return { ok: false, reason: "invalid_response" };
  const long = await call<Record<string, unknown>>(
    `https://graph.instagram.com/access_token?${q({ grant_type: "ig_exchange_token", client_secret: env.META_APP_SECRET!, access_token: short.data.access_token })}`,
  );
  if (!long.ok) return long;
  if (!opaqueToken(long.data.access_token) || typeof long.data.expires_in !== "number" || !Number.isFinite(long.data.expires_in) || long.data.expires_in <= 0 || long.data.expires_in > 90 * 86_400) return { ok: false, reason: "invalid_response" };
  // Facebook User의 permissions 경로를 Instagram Login에 추정 적용하지 않는다. 명시된 발급 범위만 쓴다.
  const shortScopes = explicitScopes(short.data), longScopes = explicitScopes(long.data);
  if ((("scope" in short.data || "permissions" in short.data) && !shortScopes) || (("scope" in long.data || "permissions" in long.data) && !longScopes)) return { ok: false, reason: "grant_unverified" };
  if (shortScopes && longScopes && JSON.stringify(shortScopes) !== JSON.stringify(longScopes)) return { ok: false, reason: "grant_unverified" };
  const grantedScopes = longScopes ?? shortScopes;
  if (!grantedScopes) return { ok: false, reason: "grant_unverified" };
  const me = await call<Record<string, unknown>>(`${IG}/me?${q({ fields: "user_id,username,account_type", access_token: long.data.access_token })}`);
  if (!me.ok) return me;
  const igUserId = providerId(me.data.user_id);
  if (!igUserId || igUserId !== providerId(short.data.user_id) || typeof me.data.username !== "string" || !/^[A-Za-z0-9_.]{1,30}$/.test(me.data.username) || typeof me.data.account_type !== "string") return { ok: false, reason: "invalid_response" };
  const accountType = me.data.account_type.toUpperCase();
  if (!["BUSINESS", "CREATOR", "MEDIA_CREATOR"].includes(accountType)) return { ok: false, reason: "personal_account" };
  return {
    ok: true,
    data: { token: long.data.access_token, expiresAt: Date.now() + long.data.expires_in * 1000, igUserId, username: me.data.username, accountType, grantedScopes },
  };
}

// --- 연결 경로 지표 (C4) ---
type InsightsBody = { data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] };

export async function mediaInsights(env: Env, token: string, mediaId: string): Promise<IgResult<Partial<Record<Metric, number>>>> {
  if (isFake(env)) return { ok: true, data: { views: 1520, likes: 210, saved: 34, shares: 12, comments: 18, reach: 1300, reposts: 2 } };
  const r = await call<InsightsBody>(`${IG}/${mediaId}/insights?${q({ metric: "views,likes,saved,shares,comments,reach,reposts", access_token: token })}`);
  if (!r.ok) return r;
  const out: Partial<Record<Metric, number>> = {};
  for (const d of r.data.data) out[d.name as Metric] = d.total_value?.value ?? d.values?.[0]?.value ?? 0;
  return { ok: true, data: out };
}

// Meta v26 IGMedia fields: facebook/facebook-python-business-sdk/adobjects/igmedia.py.
// 기본 미디어 읽기 권한(instagram_business_basic)으로 받은 메타데이터에서 영상 표지/이미지를 고른다.
export async function mediaMetadata(env: Env, token: string, mediaId: string): Promise<IgResult<DiscoveredMedia>> {
  if (isFake(env)) return { ok: true, data: { id: mediaId, permalink: `https://www.instagram.com/reel/${mediaId}/`, timestamp: new Date().toISOString(), media_type: "VIDEO" } };
  return call<DiscoveredMedia>(`${IG}/${encodeURIComponent(mediaId)}?${q({ fields: "id,permalink,timestamp,media_type,thumbnail_url,media_url", access_token: token })}`);
}

export const mediaThumbnailUrl = (media: Pick<DiscoveredMedia, "media_type" | "thumbnail_url" | "media_url">): string | null =>
  media.thumbnail_url || (media.media_type === "IMAGE" || media.media_type === "CAROUSEL_ALBUM" ? media.media_url ?? null : null);

// --- 미연결 경로 (C5) ---
export type DiscoveredMedia = {
  id: string;
  permalink: string;
  timestamp: string;
  media_product_type?: string;
  media_type?: string;
  like_count?: number;
  comments_count?: number;
  view_count?: number;
  thumbnail_url?: string;
  media_url?: string;
};

// ponytail: 최근 50개 게시물만 본다. 그보다 오래된 게시물은 못 찾음(추론). 페이지 넘김은 필요해지면 추가
export async function discoverMedia(env: Env, sys: { token: string; igUserId: string; host: "fb" | "ig" }, username: string, shortcode: string): Promise<IgResult<DiscoveredMedia | null>> {
  if (isFake(env)) {
    return {
      ok: true,
      data: { id: `fake_media_${shortcode}`, permalink: `https://www.instagram.com/reel/${shortcode}/`, timestamp: new Date(Date.now() - 3_600_000).toISOString(), media_product_type: "REELS", like_count: 120, comments_count: 9, view_count: 980 },
    };
  }
  const fields = `business_discovery.username(${username}){media.limit(50){id,permalink,timestamp,media_type,media_product_type,like_count,comments_count,view_count,thumbnail_url,media_url}}`;
  const r = await call<{ business_discovery?: { media?: { data: DiscoveredMedia[] } } }>(`${sys.host === "fb" ? FB : IG}/${sys.igUserId}?${q({ fields, access_token: sys.token })}`);
  if (!r.ok) return r;
  const list = r.data.business_discovery?.media?.data ?? [];
  return { ok: true, data: list.find((m) => parsePostUrl(m.permalink)?.shortcode === shortcode) ?? null };
}

// --- 브랜드 계정 (F-64) ---
export type IgMedia = { id: string; caption?: string; media_type?: string; permalink: string; thumbnail_url?: string; media_url?: string; timestamp: string };

export async function recentMedia(env: Env, token: string): Promise<IgResult<IgMedia[]>> {
  if (isFake(env)) {
    return {
      ok: true,
      data: [1, 2, 3].map((i) => ({ id: `fake_brand_media_${i}`, caption: `테스트 게시물 ${i}`, media_type: "VIDEO", permalink: `https://www.instagram.com/reel/FAKE${i}/`, timestamp: new Date(Date.now() - i * 86_400_000).toISOString() })),
    };
  }
  const r = await call<{ data: IgMedia[] }>(`${IG}/me/media?${q({ fields: "id,caption,media_type,permalink,thumbnail_url,media_url,timestamp", limit: "25", access_token: token })}`);
  return r.ok ? { ok: true, data: r.data.data } : r;
}

// 댓글 트리거 비공개 답장 (C1-a): POST /{ig-user-id}/messages, recipient.comment_id
// [검증 필요] 인스타그램 로그인 경로에서 이 형식 그대로인지 앱 검수 전 테스터 계정으로 확인
export async function sendPrivateReply(env: Env, token: string, igUserId: string, commentId: string, text: string): Promise<IgResult<{ message_id?: string }>> {
  if (isFake(env)) return { ok: true, data: { message_id: `fake_msg_${commentId}` } };
  return call(`${IG}/${igUserId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
  });
}

export async function sendPublicReply(env: Env, token: string, commentId: string, text: string): Promise<IgResult<{ id?: string }>> {
  if (isFake(env)) return { ok: true, data: { id: `fake_reply_${commentId}` } };
  return call(`${IG}/${commentId}/replies?${q({ message: text, access_token: token })}`, { method: "POST" });
}

// 웹훅 서명: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, 원문)
export async function verifySignature(env: Env, raw: string, header: string | undefined): Promise<boolean> {
  if (isFake(env) && !env.META_APP_SECRET) return true;
  if (!env.META_APP_SECRET || !header?.startsWith("sha256=")) return false;
  return safeEqual(header.slice(7), await hmacHex(env.META_APP_SECRET, raw));
}
