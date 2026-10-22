import { Hono } from "hono";
import { eq, lt } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { oauthStates, users } from "../../db/schema";
import { base64url, newId, newToken, now } from "../../lib/ids";
import { googleAction, googleKeys, verifyGoogleIdToken, type GoogleClaims } from "../../lib/jwt";
import { createSession } from "../../middleware/auth";
import { MIN } from "./shared";

// 구글 로그인 (OAuth 2.0 + OIDC, PKCE S256). 패키지 없이 fetch 와 Web Crypto 로 처리한다

const STATE_TTL = 10 * MIN;
const googleEnabled = (env: Env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
const redirectUri = (env: Env) => `${env.APP_URL}/api/auth/google/callback`;
// 열린 리다이렉트 방지: 같은 사이트 경로만
const safeNext = (next: string | undefined) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
type SavedState = typeof oauthStates.$inferSelect;

async function findOrCreateGoogleUser(db: Db, g: GoogleClaims): Promise<{ id: string } | "email_unverified"> {
  const bySub = await db.select({ id: users.id }).from(users).where(eq(users.googleSub, g.sub)).get();
  const byEmail = bySub ? undefined : await db.select({ id: users.id }).from(users).where(eq(users.email, g.email)).get();
  const action = googleAction(!!bySub, !!byEmail, g.emailVerified);
  if (action === "login") return bySub!;
  if (action === "email_unverified") return action;
  if (action === "link") {
    await db.update(users).set({ googleSub: g.sub }).where(eq(users.id, byEmail!.id));
    return byEmail!;
  }
  // 임시 가입: 워크스페이스 없이 만들고, 휴대폰 인증 뒤 첫 워크스페이스를 만든다
  const id = newId();
  await db.insert(users).values({ id, email: g.email, name: g.name, passwordHash: "", googleSub: g.sub, createdAt: now() });
  return { id };
}

async function fetchIdToken(env: Env, code: string, saved: SavedState) {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri(env), grant_type: "authorization_code", code_verifier: saved.codeVerifier }),
  });
  if (!tokenRes.ok) {
    console.error("[google:token]", tokenRes.status, await tokenRes.text());
    return null;
  }
  return (await tokenRes.json<{ id_token?: string }>()).id_token ?? "";
}

// 서명 키가 바뀌었으면(jwt_kid) 키를 새로 받아 한 번 더 검증한다. 실패면 null
async function verifyClaims(env: Env, idToken: string, saved: SavedState): Promise<GoogleClaims | null> {
  const opts = { clientId: env.GOOGLE_CLIENT_ID!, nonce: saved.nonce, nowSec: Math.floor(now() / 1000) };
  try {
    return await verifyGoogleIdToken(idToken, { ...opts, keys: await googleKeys() }).catch(async (e: unknown) => {
      if (e instanceof Error && e.message === "jwt_kid") return verifyGoogleIdToken(idToken, { ...opts, keys: await googleKeys(true) });
      throw e;
    });
  } catch (e) {
    console.error("[google:id_token]", e);
    return null;
  }
}

// state 는 한 번만 쓴다. 꺼내면서 지운다
async function takeState(db: Db, state: string) {
  const saved = await db.select().from(oauthStates).where(eq(oauthStates.state, state)).get();
  if (saved) await db.delete(oauthStates).where(eq(oauthStates.state, state));
  return saved && saved.createdAt >= now() - STATE_TTL ? saved : null;
}

export const googleRoutes = new Hono<AppEnv>()
  .get("/config", (c) => c.json({ google: googleEnabled(c.env) }))
  .get("/google/start", async (c) => {
    if (!googleEnabled(c.env)) return c.redirect("/login?error=google_disabled");
    const state = newToken(24);
    const nonce = newToken(24);
    const codeVerifier = newToken(48);
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier))));
    const db = c.var.db;
    await db.delete(oauthStates).where(lt(oauthStates.createdAt, now() - STATE_TTL));
    await db.insert(oauthStates).values({ state, nonce, codeVerifier, redirectNext: safeNext(c.req.query("next")), createdAt: now() });
    const q = new URLSearchParams({ client_id: c.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(c.env), response_type: "code", scope: "openid email profile", state, nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" });
    return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  })
  .get("/google/callback", async (c) => {
    const fail = (code: string) => c.redirect(`/login?error=${code}`);
    if (!googleEnabled(c.env)) return fail("google_disabled");
    const db = c.var.db;
    const saved = await takeState(db, c.req.query("state") ?? "");
    if (!saved) return fail("google_state");
    const code = c.req.query("code");
    if (!code) return fail("google_cancelled");
    const idToken = await fetchIdToken(c.env, code, saved);
    const claims = idToken === null ? null : await verifyClaims(c.env, idToken, saved);
    if (!claims) return fail("google_failed");
    const user = await findOrCreateGoogleUser(db, claims);
    if (user === "email_unverified") return fail("google_email_unverified");
    await createSession(c, user.id, null);
    const row = await db.select({ verifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.id, user.id)).get();
    const next = saved.redirectNext;
    return c.redirect(row?.verifiedAt ? next : `/verify-phone?next=${encodeURIComponent(next)}`);
  });
