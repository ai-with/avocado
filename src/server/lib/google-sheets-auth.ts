import { sql } from "drizzle-orm";
import type { Db } from "../db";
import type { Auth } from "../types";
import { base64url, newToken, now, sha256Hex } from "./ids";
import { decryptToken, encryptToken, hmacHex, safeEqual } from "./crypto";
import { ApiError } from "./errors";
import { safeAuthNext } from "../../shared/auth-redirect";
import { requestSheetsTokens, SHEETS_SCOPE, SheetsProviderError, sheetsAccountEmail, validSheetsScope } from "./google-sheets-provider";

const STATE_MS = 10 * 60_000;
const DEFAULT_RETURN = "/dashboard/performance";
export type SheetsConnection = { userId: string; generation: string; accessEnc: string | null; refreshEnc: string | null; scope: string; expiresAt: number | null; accountEmail: string | null; revokedAt: number | null };
type State = { userId: string; sessionId: string; generation: string; verifierEnc: string; returnTo: string; expiresAt: number; usedAt: number | null };
const connectionColumns = sql.raw("user_id AS userId,generation,access_enc AS accessEnc,refresh_enc AS refreshEnc,scope,expires_at AS expiresAt,account_email AS accountEmail,revoked_at AS revokedAt");

export const sheetsConfigured = (env: Env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.TOKEN_ENC_KEY);
export const sheetsCallbackUri = (env: Env) => `${env.APP_URL}/api/google-sheets/callback`;
export function sheetsReturnTo(raw: string | null | undefined) {
  const safe = safeAuthNext(raw);
  const target = new URL(safe, "https://app.invalid");
  return ["/dashboard/leads", "/dashboard/performance"].includes(target.pathname) ? safe : DEFAULT_RETURN;
}
export function requireSheetsConfigured(env: Env) {
  if (!sheetsConfigured(env)) throw new ApiError(503, "google_sheets_not_configured", "Google 연결을 준비 중이에요. CSV로 내보내 주세요.");
}
export async function sheetsConnection(db: Db, userId: string) {
  return (await db.all<SheetsConnection>(sql`SELECT ${connectionColumns} FROM google_sheets_connections WHERE user_id=${userId}`))[0] ?? null;
}
export async function sheetsCsrf(env: Env, auth: Auth): Promise<string | null> {
  return env.TOKEN_ENC_KEY ? hmacHex(env.TOKEN_ENC_KEY, JSON.stringify(["sheets-export", auth.user.id, auth.sessionId])) : null;
}
export async function requireSheetsCsrf(env: Env, auth: Auth, origin: string | undefined, token: string | undefined) {
  const expected = await sheetsCsrf(env, auth);
  if (!origin || origin !== new URL(env.APP_URL).origin || !expected || !token || !safeEqual(token, expected)) throw new ApiError(403, "csrf_invalid", "요청을 확인하지 못했어요. 화면을 새로 열고 다시 시도해 주세요.");
}

export async function startSheetsConnect(env: Env, db: Db, auth: Auth, returnTo: string) {
  requireSheetsConfigured(env);
  await db.run(sql`INSERT INTO google_sheets_connections (user_id,generation) VALUES (${auth.user.id},${newToken(18)}) ON CONFLICT(user_id) DO NOTHING`);
  const connection = (await sheetsConnection(db, auth.user.id))!;
  const state = newToken(32), verifier = newToken(48);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  await db.run(sql`INSERT INTO google_sheets_states (state_hash,user_id,session_id,connection_generation,verifier_enc,return_to,expires_at,created_at)
    VALUES (${await sha256Hex(state)},${auth.user.id},${auth.sessionId},${connection.generation},${await encryptToken(env.TOKEN_ENC_KEY!, verifier)},${sheetsReturnTo(returnTo)},${now() + STATE_MS},${now()})`);
  const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: sheetsCallbackUri(env), response_type: "code", scope: SHEETS_SCOPE,
    access_type: "offline", prompt: "consent select_account", include_granted_scopes: "false", state, code_challenge: challenge, code_challenge_method: "S256" });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function finishSheetsConnect(env: Env, db: Db, auth: Auth, params: { state?: string; code?: string; error?: string }) {
  const fail = (returnTo = DEFAULT_RETURN, outcome = "failed") => ({ returnTo, outcome });
  if (!params.state || params.state.length > 256) return fail();
  const hash = await sha256Hex(params.state);
  const state = (await db.all<State>(sql`SELECT user_id AS userId,session_id AS sessionId,connection_generation AS generation,verifier_enc AS verifierEnc,return_to AS returnTo,expires_at AS expiresAt,used_at AS usedAt FROM google_sheets_states WHERE state_hash=${hash}`))[0];
  if (!state || state.userId !== auth.user.id || state.sessionId !== auth.sessionId) return fail();
  const returnTo = sheetsReturnTo(state.returnTo);
  if (state.usedAt !== null || state.expiresAt < now() || !sheetsConfigured(env)) return fail(returnTo);
  const claimed = await db.all<{ id: string }>(sql`UPDATE google_sheets_states SET used_at=${now()} WHERE state_hash=${hash} AND user_id=${auth.user.id} AND session_id=${auth.sessionId} AND used_at IS NULL AND expires_at>=${now()}
    AND EXISTS (SELECT 1 FROM google_sheets_connections c WHERE c.user_id=${auth.user.id} AND c.generation=${state.generation}) RETURNING state_hash AS id`);
  if (!claimed.length) return fail(returnTo);
  if (params.error || !params.code) return fail(returnTo, params.error === "access_denied" ? "cancelled" : "failed");
  try {
    const tokens = await requestSheetsTokens(new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, code: params.code,
      grant_type: "authorization_code", redirect_uri: sheetsCallbackUri(env), code_verifier: await decryptToken(env.TOKEN_ENC_KEY!, state.verifierEnc) }));
    const stillCurrent = await db.all<{ id: string }>(sql`SELECT s.id FROM sessions s JOIN google_sheets_connections g ON g.user_id=s.user_id
      WHERE s.id=${auth.sessionId} AND s.user_id=${auth.user.id} AND s.expires_at>${now()} AND g.generation=${state.generation}`);
    if (!stillCurrent.length) return fail(returnTo);
    const accountEmail = await sheetsAccountEmail(tokens.accessToken);
    const updated = await db.all<{ id: string }>(sql`UPDATE google_sheets_connections SET generation=${newToken(18)},access_enc=${await encryptToken(env.TOKEN_ENC_KEY!, tokens.accessToken)},
      refresh_enc=${tokens.refreshToken ? await encryptToken(env.TOKEN_ENC_KEY!, tokens.refreshToken) : null},scope=${tokens.scope},expires_at=${now() + tokens.expiresIn * 1000},account_email=${accountEmail},connected_at=${now()},revoked_at=NULL
      WHERE user_id=${auth.user.id} AND generation=${state.generation}
      AND EXISTS (SELECT 1 FROM sessions s WHERE s.id=${auth.sessionId} AND s.user_id=${auth.user.id} AND s.expires_at>${now()}) RETURNING user_id AS id`);
    return updated.length ? { returnTo, outcome: "connected" } : fail(returnTo);
  } catch { return fail(returnTo); }
}

export async function disconnectSheets(env: Env, db: Db, auth: Auth) {
  const d1 = db.$client, at = now();
  await d1.batch([
    d1.prepare("UPDATE google_sheets_connections SET generation=?,access_enc=NULL,refresh_enc=NULL,scope='',expires_at=NULL,account_email=NULL,revoked_at=? WHERE user_id=?").bind(newToken(18), at, auth.user.id),
    d1.prepare("DELETE FROM google_sheets_states WHERE user_id=?").bind(auth.user.id),
    d1.prepare("UPDATE google_sheets_exports SET status='cancelled',payload_enc=NULL,error_code='connection_disconnected',updated_at=? WHERE user_id=? AND status NOT IN ('done','unknown','failed')").bind(at, auth.user.id),
  ]);
}

export async function sheetsAccessToken(env: Env, db: Db, userId: string, generation: string): Promise<string> {
  requireSheetsConfigured(env);
  const connection = await sheetsConnection(db, userId);
  if (!connection || connection.generation !== generation || connection.revokedAt !== null || !connection.accessEnc || !validSheetsScope(connection.scope)) throw new SheetsProviderError("reconnect_required");
  try {
    if ((connection.expiresAt ?? 0) > now() + 60_000) return await decryptToken(env.TOKEN_ENC_KEY!, connection.accessEnc);
    if (!connection.refreshEnc) throw new SheetsProviderError("reconnect_required");
    const refreshed = await requestSheetsTokens(new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token", refresh_token: await decryptToken(env.TOKEN_ENC_KEY!, connection.refreshEnc) }), connection.scope);
    const updated = await db.all<{ id: string }>(sql`UPDATE google_sheets_connections SET access_enc=${await encryptToken(env.TOKEN_ENC_KEY!, refreshed.accessToken)},
      refresh_enc=${refreshed.refreshToken ? await encryptToken(env.TOKEN_ENC_KEY!, refreshed.refreshToken) : connection.refreshEnc},scope=${refreshed.scope},expires_at=${now() + refreshed.expiresIn * 1000}
      WHERE user_id=${userId} AND generation=${generation} AND access_enc=${connection.accessEnc} AND revoked_at IS NULL RETURNING user_id AS id`);
    if (!updated.length) throw new SheetsProviderError("connection_changed");
    return refreshed.accessToken;
  } catch (error) {
    if (error instanceof SheetsProviderError) {
      // 다른 탭이 같은 연결 세대의 refresh를 먼저 끝냈다면 그 검증된 토큰을 쓴다.
      // 재연결은 generation이 바뀌므로 이전 계정의 응답으로 덮거나 재사용하지 않는다.
      if (["connection_changed", "reconnect_required"].includes(error.code)) {
        const current = await sheetsConnection(db, userId);
        if (current && current.generation === generation && current.revokedAt === null && current.accessEnc && current.accessEnc !== connection.accessEnc && validSheetsScope(current.scope) && (current.expiresAt ?? 0) > now() + 60_000) {
          try { return await decryptToken(env.TOKEN_ENC_KEY!, current.accessEnc); } catch { throw new SheetsProviderError("reconnect_required"); }
        }
      }
      if (["reconnect_required", "scope_not_granted"].includes(error.code)) await db.run(sql`UPDATE google_sheets_connections SET generation=${newToken(18)},access_enc=NULL,refresh_enc=NULL,revoked_at=${now()}
        WHERE user_id=${userId} AND generation=${generation} AND access_enc=${connection.accessEnc}`);
      throw error;
    }
    throw new SheetsProviderError("reconnect_required");
  }
}

export function sheetsAccessPredicate(auth: Auth, workspaceId: string, generation: string) {
  return sql`EXISTS (SELECT 1 FROM members m JOIN sessions s ON s.user_id=m.user_id
    JOIN google_sheets_connections g ON g.user_id=m.user_id WHERE m.user_id=${auth.user.id} AND m.workspace_id=${workspaceId} AND s.id=${auth.sessionId} AND s.expires_at>${now()}
    AND g.generation=${generation} AND g.revoked_at IS NULL AND g.access_enc IS NOT NULL AND g.scope=${SHEETS_SCOPE})`;
}
export async function assertSheetsAccess(db: Db, auth: Auth, workspaceId: string, generation: string) {
  const rows = await db.all<{ id: number }>(sql`SELECT 1 AS id WHERE ${sheetsAccessPredicate(auth, workspaceId, generation)}`);
  if (!rows.length) throw new SheetsProviderError("connection_changed");
}
