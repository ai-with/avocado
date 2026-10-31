import { z } from "zod";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AppEnv, Auth } from "../types";
import type { Db } from "../db";
import { guideInfluencers, guides, igConnections, influencers, workspaces } from "../db/schema";
import { ApiError } from "./errors";
import { newId, newToken, now, sha256Hex } from "./ids";
import { encryptToken, safeEqual } from "./crypto";
import { authorizeUrl, exchangeCode, igConfigured, isFake, tokenKey } from "./instagram";
import { igConnectionState } from "./ig-connection-state";
import { brandNameOf } from "./brands";
import { workspaceCtx } from "../middleware/auth";
import { IG_SCOPES, type IgTarget } from "../../shared/performance";
import { logEvent } from "./events";

const STATE_MS = 10 * 60_000;
const COOKIE_S = 15 * 60; // 인증은 10분, 원래 브라우저의 만료 안내 복귀만 5분 더 허용한다.
const NEUTRAL_RETURN = "/connect/invalid";
type Lang = "ko" | "en";
type Mode = "guide" | "connect" | "settings";
type Connection = typeof igConnections.$inferSelect;
type Target = { target: "influencer" | "client_brand"; workspaceId: string; brandName: string; influencerId: string | null; giId: string | null; guideToken: string | null; connectToken: string; name: string; lang: Lang; connection: Connection | null };
type State = { stateHash: string; nonceHash: string; target: IgTarget; workspaceId: string; connectionId: string; generation: string; giId: string | null; connectTokenHash: string | null; guideTokenHash: string | null; userId: string | null; sessionId: string | null; returnMode: Mode; returnPath: string; lang: Lang; expiresAt: number; usedAt: number | null };
export const instagramStartBody = z.object({ target: z.enum(["influencer", "client_brand", "brand_sender"]), token: z.string().min(8).max(200).optional(), returnMode: z.enum(["guide", "connect", "settings"]).optional(), lang: z.enum(["ko", "en"]).optional() }).strict();
type Start = z.infer<typeof instagramStartBody>;
const production = (env: Env) => env.APP_ENV === "production";
export const instagramOAuthConfigured = (env: Env) => igConfigured(env) && (!production(env) || !isFake(env));
const cookieName = (env: Env, hash: string) => `${production(env) ? "__Host-" : ""}ig-oauth-${hash.slice(0, 16)}`;
const cookieOptions = (env: Env) => ({ path: "/", secure: production(env), httpOnly: true, sameSite: "Lax" as const });
export function assertInstagramOrigin(c: Context<AppEnv>) {
  const expected = production(c.env) ? new URL(c.env.APP_URL).origin : new URL(c.req.url).origin;
  if (c.req.header("Origin") !== expected) throw new ApiError(403, "csrf_invalid", "요청을 확인하지 못했어요. 원래 화면에서 다시 시도해 주세요.");
}
export function instagramEditorPredicate(auth: Auth, workspaceId: string) {
  return sql`EXISTS (SELECT 1 FROM sessions s JOIN members m ON m.user_id=s.user_id JOIN users u ON u.id=s.user_id
    WHERE s.id=${auth.sessionId} AND s.user_id=${auth.user.id} AND s.expires_at>${now()} AND s.current_workspace_id=${workspaceId} AND u.phone_verified_at IS NOT NULL AND m.workspace_id=${workspaceId} AND m.role IN ('owner','editor'))`;
}

export async function latestInstagramConnection(db: Db, workspaceId: string, target: "influencer" | "brand_sender", influencerId: string | null = null) {
  return await db.select().from(igConnections).where(and(eq(igConnections.workspaceId, workspaceId), eq(igConnections.target, target), target === "influencer" ? eq(igConnections.influencerId, influencerId!) : undefined))
    .orderBy(desc(igConnections.connectedAt), desc(igConnections.createdAt), desc(igConnections.id)).get() ?? null;
}

async function guideTarget(db: Db, condition: SQL): Promise<Target | null> {
  const row = await db.select({ giId: guideInfluencers.id, influencerId: influencers.id, workspaceId: guides.workspaceId, guideId: guides.id, guideToken: guideInfluencers.guideToken,
    connectToken: guideInfluencers.connectToken, expiresAt: guideInfluencers.tokenExpiresAt, published: guides.status, name: influencers.displayName, lang: influencers.lang })
    .from(guideInfluencers).innerJoin(guides, eq(guides.id, guideInfluencers.guideId))
    .innerJoin(influencers, and(eq(influencers.id, guideInfluencers.influencerId), eq(influencers.workspaceId, guides.workspaceId))).where(condition).get();
  if (!row) return null;
  if (row.published !== "published" || row.expiresAt <= now()) throw new ApiError(410, "connect_link_expired", "연결 링크가 만료됐어요. 브랜드에 새 링크를 요청해 주세요.");
  return { target: "influencer", workspaceId: row.workspaceId, influencerId: row.influencerId, giId: row.giId, guideToken: row.guideToken, connectToken: row.connectToken,
    brandName: await brandNameOf(db, row.workspaceId, row.guideId), name: row.name, lang: row.lang,
    connection: await latestInstagramConnection(db, row.workspaceId, "influencer", row.influencerId) };
}

export async function resolveInstagramConnect(db: Db, token: string): Promise<Target> {
  if (!/^[\w-]{8,200}$/.test(token)) throw new ApiError(404, "connect_not_found", "연결 링크를 찾을 수 없어요.");
  const personal = await guideTarget(db, eq(guideInfluencers.connectToken, token));
  if (personal) return personal;
  const row = await db.select({ connection: igConnections, brandName: workspaces.name }).from(igConnections).innerJoin(workspaces, eq(workspaces.id, igConnections.workspaceId))
    .where(and(eq(igConnections.connectToken, token), eq(igConnections.target, "client_brand"))).get();
  if (!row) throw new ApiError(404, "connect_not_found", "연결 링크를 찾을 수 없어요.");
  if (row.connection.revokedAt !== null || !row.connection.connectExpiresAt || row.connection.connectExpiresAt <= now()) throw new ApiError(410, "connect_link_expired", "연결 링크가 만료됐어요. 브랜드에 새 링크를 요청해 주세요.");
  return { target: "client_brand", workspaceId: row.connection.workspaceId, influencerId: null, giId: null, guideToken: null, connectToken: token, brandName: row.brandName,
    name: row.connection.label ?? "", lang: "ko", connection: row.connection };
}

function returnPath(target: Target, mode: Mode, lang: Lang) {
  if (mode === "guide" && target.guideToken) return `/g/${encodeURIComponent(target.guideToken)}?lang=${lang}`;
  return `/connect/${encodeURIComponent(target.connectToken)}?lang=${lang}&returnMode=connect`;
}
function safeStoredReturn(raw: string): string {
  try {
    if (/[\\\u0000-\u0020\u007f]/.test(raw) || !raw.startsWith("/") || raw.startsWith("//")) return NEUTRAL_RETURN;
    const url = new URL(raw, "https://app.invalid");
    if (url.origin !== "https://app.invalid" || !(/^\/(g|connect)\/[\w-]{8,200}$/.test(url.pathname) || url.pathname === "/dashboard/settings/integrations")) return NEUTRAL_RETURN;
    const params = new URLSearchParams();
    if (url.searchParams.get("lang") === "ko" || url.searchParams.get("lang") === "en") params.set("lang", url.searchParams.get("lang")!);
    if (url.pathname.startsWith("/connect/")) params.set("returnMode", "connect");
    return url.pathname + (params.size ? `?${params}` : "");
  } catch { return NEUTRAL_RETURN; }
}

export async function publicGuideInstagram(db: Db, env: Env, giId: string, lang: Lang, expectedGuideToken: string) {
  const target = await guideTarget(db, and(eq(guideInfluencers.id, giId), eq(guideInfluencers.guideToken, expectedGuideToken))!);
  if (!target) throw new ApiError(410, "connect_link_expired", "연결 링크가 만료됐어요. 브랜드에 새 링크를 요청해 주세요.");
  const state = target.connection ? igConnectionState(target.connection) : { connected: false, reason: null };
  return { configured: instagramOAuthConfigured(env), status: state.connected ? "connected" : state.reason ?? "not_connected", connected: state.connected,
    username: target.connection?.username ?? null, connectUrl: `/connect/${target.connectToken}?returnMode=guide&lang=${lang}` };
}
export async function instagramConnectInfo(db: Db, env: Env, token: string, options: { returnMode?: string; lang?: string }) {
  const target = await resolveInstagramConnect(db, token);
  await instagramEvent(db, target.workspaceId, "ig_connect_viewed", { target: target.target });
  const lang: Lang = options.lang === "ko" || options.lang === "en" ? options.lang : target.lang;
  const mode: Mode = options.returnMode === "guide" && target.target === "influencer" ? "guide" : "connect";
  const state = target.connection ? igConnectionState(target.connection) : { connected: false, expired: false, disconnected: false, reason: null };
  return { target: target.target, name: target.name, lang, agencyName: target.target === "client_brand" ? target.brandName : null, brandName: target.brandName,
    configured: instagramOAuthConfigured(env), ...state, username: target.connection?.username ?? null, scopes: IG_SCOPES[target.target], returnMode: mode, returnUrl: returnPath(target, mode, lang) };
}

async function instagramEvent(db: Db, workspaceId: string, name: string, props: Record<string, unknown>) {
  try { await logEvent(db, workspaceId, name, props); }
  catch { console.warn("[ig:oauth_event_failed]"); } // 공급자 응답·capability·원문 오류를 로그에 남기지 않는다.
}

async function reserveConnection(db: Db, target: { target: IgTarget; workspaceId: string; influencerId: string | null; connection: Connection | null }): Promise<Connection> {
  if (target.connection) return target.connection;
  const id = newId();
  await db.run(sql`INSERT INTO ig_connections (id,workspace_id,influencer_id,target,scopes,generation,created_at)
    SELECT ${id},${target.workspaceId},${target.influencerId},${target.target},'[]',${newToken(18)},${now()}
    WHERE NOT EXISTS (SELECT 1 FROM ig_connections WHERE workspace_id=${target.workspaceId} AND target=${target.target} AND influencer_id IS ${target.influencerId})`);
  return (await latestInstagramConnection(db, target.workspaceId, target.target as "influencer" | "brand_sender", target.influencerId))!;
}

export async function startInstagramOAuth(c: Context<AppEnv>, input: Start) {
  assertInstagramOrigin(c);
  if (!instagramOAuthConfigured(c.env)) throw new ApiError(503, "not_configured", "인스타그램 연결을 준비 중이에요.");
  const db = c.var.db;
  let target: Target | null = null, userId: string | null = null, sessionId: string | null = null, workspaceId: string, connection: Connection;
  let mode: Mode = input.returnMode ?? (input.target === "brand_sender" ? "settings" : "connect"), lang: Lang = input.lang ?? "ko", back: string;
  if (input.target === "brand_sender") {
    const auth = workspaceCtx(c);
    if (!["owner", "editor"].includes(auth.role)) throw new ApiError(403, "forbidden", "이 작업을 할 권한이 없어요.");
    if (mode !== "settings" || input.token) throw new ApiError(400, "invalid_target", "연결 대상을 확인해 주세요.");
    userId = auth.user.id; sessionId = auth.sessionId; workspaceId = auth.workspace.id;
    connection = await reserveConnection(db, { target: "brand_sender", workspaceId, influencerId: null, connection: await latestInstagramConnection(db, workspaceId, "brand_sender") });
    back = "/dashboard/settings/integrations";
  } else {
    if (!input.token || mode === "settings") throw new ApiError(400, "invalid_target", "연결 대상을 확인해 주세요.");
    target = await resolveInstagramConnect(db, input.token);
    if (target.target !== input.target || (mode === "guide" && target.target !== "influencer")) throw new ApiError(400, "invalid_target", "연결 대상을 확인해 주세요.");
    workspaceId = target.workspaceId; lang = input.lang ?? target.lang;
    if (c.var.auth) { userId = c.var.auth.user.id; sessionId = c.var.auth.sessionId; }
    connection = await reserveConnection(db, target); back = returnPath(target, mode, lang);
  }
  const state = newToken(32), hash = await sha256Hex(state), nonce = newToken(32);
  await db.run(sql`INSERT INTO ig_oauth_states (state_hash,nonce_hash,target,workspace_id,connection_id,connection_generation,guide_influencer_id,connect_token_hash,guide_token_hash,user_id,session_id,return_mode,return_path,lang,expires_at,created_at)
    VALUES (${hash},${await sha256Hex(nonce)},${input.target},${workspaceId},${connection.id},${connection.generation},${target?.giId ?? null},${target ? await sha256Hex(target.connectToken) : null},${target?.guideToken ? await sha256Hex(target.guideToken) : null},${userId},${sessionId},${mode},${back},${lang},${now() + STATE_MS},${now()})`);
  setCookie(c, cookieName(c.env, hash), nonce, { ...cookieOptions(c.env), maxAge: COOKIE_S });
  // 로컬 fake는 로컬 D1·nonce 쿠키가 있는 요청 origin으로 복귀한다. 실제 Meta callback 설정은 APP_URL을 유지한다.
  const oauthEnv = !production(c.env) && isFake(c.env) ? { ...c.env, APP_URL: new URL(c.req.url).origin } : c.env;
  return { authorizationUrl: authorizeUrl(oauthEnv, state, IG_SCOPES[input.target]) };
}

type Bound = { state: State; target: Target | null; predicate: () => SQL };
async function bindCurrent(c: Context<AppEnv>, state: State): Promise<Bound | null> {
  const auth = c.var.auth;
  if (state.userId && (!auth || auth.user.id !== state.userId || auth.sessionId !== state.sessionId)) return null;
  const actor = () => state.userId ? sql`EXISTS (SELECT 1 FROM sessions s WHERE s.id=${state.sessionId} AND s.user_id=${state.userId} AND s.expires_at>${now()})` : sql`1`;
  if (state.target === "brand_sender") {
    if (!auth || !state.userId || auth.workspace?.id !== state.workspaceId || !auth.phoneVerified) return null;
    return { state, target: null, predicate: () => instagramEditorPredicate(auth, state.workspaceId) };
  }
  let target: Target | null;
  try { target = state.giId ? await guideTarget(c.var.db, eq(guideInfluencers.id, state.giId)) : null;
    if (!target && state.target === "client_brand") {
      const row = await c.var.db.select().from(igConnections).where(eq(igConnections.id, state.connectionId)).get();
      target = row?.connectToken ? await resolveInstagramConnect(c.var.db, row.connectToken) : null;
    }
  } catch { return null; }
  if (!target || target.workspaceId !== state.workspaceId || target.target !== state.target || !state.connectTokenHash || !safeEqual(await sha256Hex(target.connectToken), state.connectTokenHash) || (target.guideToken && (!state.guideTokenHash || !safeEqual(await sha256Hex(target.guideToken), state.guideTokenHash)))) return null;
  const original = target;
  return { state, target, predicate: () => state.target === "influencer" ? sql`${actor()} AND influencer_id=${original.influencerId} AND EXISTS (SELECT 1 FROM guide_influencers gi JOIN guides g ON g.id=gi.guide_id JOIN influencers i ON i.id=gi.influencer_id
    WHERE gi.id=${state.giId} AND gi.influencer_id=${original.influencerId} AND gi.connect_token=${original.connectToken} AND gi.guide_token=${original.guideToken} AND gi.token_expires_at>${now()} AND g.status='published' AND g.workspace_id=${state.workspaceId} AND i.workspace_id=g.workspace_id)`
    : sql`${actor()} AND connect_token=${original.connectToken} AND connect_expires_at>${now()} AND revoked_at IS NULL` };
}

export async function finishInstagramOAuth(c: Context<AppEnv>, params: { state?: string; code?: string; error?: string }) {
  const failed = (path = NEUTRAL_RETURN, error = "invalid_state", cancelled = false) => ({ returnPath: safeStoredReturn(path), outcome: cancelled ? "cancelled" : "failed", error });
  if (!params.state || !/^[\w-]{32,128}$/.test(params.state)) return failed();
  const hash = await sha256Hex(params.state), name = cookieName(c.env, hash), nonce = getCookie(c, name);
  const state = (await c.var.db.all<State>(sql`SELECT state_hash AS stateHash,nonce_hash AS nonceHash,target,workspace_id AS workspaceId,connection_id AS connectionId,connection_generation AS generation,guide_influencer_id AS giId,
    connect_token_hash AS connectTokenHash,guide_token_hash AS guideTokenHash,user_id AS userId,session_id AS sessionId,return_mode AS returnMode,return_path AS returnPath,lang,expires_at AS expiresAt,used_at AS usedAt FROM ig_oauth_states WHERE state_hash=${hash}`))[0];
  if (!state || !nonce || !safeEqual(await sha256Hex(nonce), state.nonceHash)) return failed();
  deleteCookie(c, name, cookieOptions(c.env));
  const back = safeStoredReturn(state.returnPath);
  if (state.usedAt !== null || state.expiresAt <= now() || !instagramOAuthConfigured(c.env)) return failed(back, "invalid_state");
  const bound = await bindCurrent(c, state);
  if (!bound) return failed(back, "stale_request");
  const claimed = await c.var.db.all<{ id: string }>(sql`UPDATE ig_oauth_states SET used_at=${now()} WHERE state_hash=${hash} AND used_at IS NULL AND expires_at>${now()}
    AND EXISTS (SELECT 1 FROM ig_connections WHERE id=${state.connectionId} AND workspace_id=${state.workspaceId} AND target=${state.target} AND generation=${state.generation} AND ${bound.predicate()}) RETURNING state_hash AS id`);
  if (!claimed.length) return failed(back, "stale_request");
  const providerFailed = async (reason: string, cancelled = false) => {
    await instagramEvent(c.var.db, state.workspaceId, "ig_connect_failed", { reason, target: state.target });
    return failed(back, reason, cancelled);
  };
  if (params.error || !params.code) return providerFailed("denied", true);
  try {
    const response = await exchangeCode(c.env, params.code, IG_SCOPES[state.target]);
    if (!response.ok) return providerFailed(["token_expired", "grant_unverified", "personal_account"].includes(response.reason) ? response.reason : "api_error");
    const account = response.data;
    if (!account.accountType || !["BUSINESS", "MEDIA_CREATOR", "CREATOR"].includes(account.accountType.toUpperCase())) return providerFailed("personal_account");
    const required = IG_SCOPES[state.target], granted = account.grantedScopes;
    if (!granted?.length || !required.every((scope) => granted.includes(scope))) return providerFailed("grant_unverified");
    if (!account.token || !/^[0-9A-Za-z_-]+$/.test(account.igUserId) || !account.username || !Number.isFinite(account.expiresAt) || account.expiresAt <= now()) return providerFailed("api_error");
    const updated = await c.var.db.all<{ id: string }>(sql`UPDATE ig_connections SET generation=${newToken(18)},ig_user_id=${account.igUserId},username=${account.username},account_type=${account.accountType},
      scopes=${JSON.stringify(granted)},grants_verified_at=${now()},token_enc=${await encryptToken(tokenKey(c.env)!, account.token)},expires_at=${account.expiresAt},connected_at=${now()},revoked_at=NULL,disconnected_at=NULL,disconnected_reason=NULL
      WHERE id=${state.connectionId} AND workspace_id=${state.workspaceId} AND target=${state.target} AND generation=${state.generation} AND ${bound.predicate()} RETURNING id`);
    if (!updated.length) return failed(back, "stale_request");
    await instagramEvent(c.var.db, state.workspaceId, "ig_connect_completed", { account_type: account.accountType, target: state.target });
    return { returnPath: back, outcome: "connected", error: null };
  } catch { return providerFailed("api_error"); }
}
