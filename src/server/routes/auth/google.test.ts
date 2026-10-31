import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db";
import { ApiError, errorBody } from "../../lib/errors";
import { base64url, sha256Hex } from "../../lib/ids";
import type { Jwk } from "../../lib/jwt";
import { loadSession } from "../../middleware/auth";
import { inviteRoutes } from "../invites";
import { googleRoutes } from "./google";
import { createSqliteD1, type TestSqlite } from "../../test/sqlite-d1";

const databases: TestSqlite[] = [];
const NOW = Date.parse("2026-10-31T06:00:00Z");
const INVITE = "/invite/invite-token";
let keys: Jwk[];
let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  privateKey = pair.privateKey;
  keys = [{ ...await crypto.subtle.exportKey("jwk", pair.publicKey) as Jwk, kid: "google-test" }];
});
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(phoneVerified = false) {
  const { db, d1: native } = await createSqliteD1();
  databases.push(db);
  let afterStateRead: (() => Promise<void>) | undefined;
  let beforeQuery: ((sql: string) => void) | undefined;
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => new Proxy(statement, { get(target, key) {
    if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values), sql);
    if (key === "raw" || key === "all") return async () => {
      const result = key === "raw" ? await target.raw() : await target.all();
      if (/^select\b/i.test(sql) && sql.includes('from "oauth_states"')) await afterStateRead?.();
      return result;
    };
    return Reflect.get(target, key);
  } });
  const d1 = { ...native, prepare: (sql: string) => { beforeQuery?.(sql); return wrap(native.prepare(sql), sql); } } as D1Database;
  db.prepare("INSERT INTO users (id, email, password_hash, name, created_at, phone_verified_at) VALUES ('u1', 'invited@example.com', '', '초대받은 사람', ?, ?)").run(NOW, phoneVerified ? NOW : null);
  db.exec("INSERT INTO workspaces (id, name, created_at) VALUES ('w1', '초대한 팀', 1)");
  db.prepare("INSERT INTO invites (id, workspace_id, email, role, token, expires_at, created_at) VALUES ('i1', 'w1', 'invited@example.com', 'editor', 'invite-token', ?, ?)").run(NOW + 60_000, NOW);
  const env = { DB: d1, APP_ENV: "production", APP_URL: "https://app.example.com", GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "test-secret" } as Env;
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", getDb(c.env.DB)); await next(); });
  app.use("*", loadSession);
  app.route("/api/auth", googleRoutes);
  app.route("/api/invites", inviteRoutes);
  app.onError((error, c) => error instanceof ApiError ? c.json(errorBody(error.code, error.message), error.status) : c.text("internal error", 500));
  const cookies = new Map<string, string>();
  const call = async (path: string, init?: RequestInit, bindings = env) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("cookie")) headers.set("cookie", [...cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    const response = await app.request(path, { ...init, headers }, bindings);
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(";", 1)[0]!, equal = first.indexOf("=");
      if (/Max-Age=0\b/i.test(cookie)) cookies.delete(first.slice(0, equal));
      else cookies.set(first.slice(0, equal), first.slice(equal + 1));
    }
    return response;
  };
  const start = async (next = INVITE) => {
    const response = await call(`/api/auth/google/start?next=${encodeURIComponent(next)}`);
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("location")!);
    const state = target.searchParams.get("state")!;
    const saved = db.prepare("SELECT nonce, redirect_next FROM oauth_states WHERE state = ?").all(state)[0]!;
    return { state, nonce: String(saved.nonce), next: saved.redirect_next, cookies: response.headers.getSetCookie(), url: target };
  };
  return { db, env, call, start, cookies, setAfterStateRead: (fn: () => Promise<void>) => { afterStateRead = fn; }, setBeforeQuery: (fn?: (sql: string) => void) => { beforeQuery = fn; } };
}

async function token(nonce: string, extra: Record<string, unknown> = {}) {
  const encode = (value: object) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const input = `${encode({ alg: "RS256", kid: "google-test" })}.${encode({ iss: "https://accounts.google.com", aud: "client", exp: NOW / 1000 + 300, nonce, sub: "google-user", email: "invited@example.com", email_verified: true, name: "초대받은 사람", ...extra })}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(input));
  return `${input}.${base64url(new Uint8Array(signature))}`;
}

function googleFetch(idToken: string) {
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url) === "https://oauth2.googleapis.com/token") return Response.json({ id_token: idToken });
    if (String(url) === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys });
    throw new Error("예상하지 않은 외부 요청");
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const targetOf = (response: Response) => new URL(response.headers.get("location")!, "https://app.example.com");
const sessionCookie = (response: Response) => response.headers.getSetCookie().find((cookie) => cookie.startsWith("sid="))!.split(";", 1)[0]!;

describe("Google OAuth의 브라우저 바인딩·원자적 state 소비", () => {
  it("운영은 state별 Host cookie에 nonce를 묶고 기존 scope·PKCE·Google 요청 계약을 유지한다", async () => {
    const { db, call, start } = await setup(true); const saved = await start();
    const cookie = saved.cookies[0]!;
    expect(cookie).toMatch(/^__Host-google-oauth-/); expect(cookie).toContain(`=${saved.nonce};`);
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("Path=/"); expect(cookie).toContain("SameSite=Lax"); expect(cookie).toContain("Max-Age=900"); expect(cookie).not.toContain("Domain=");
    expect(cookie.split("=", 1)[0]).not.toContain(saved.state);
    expect(saved.url.origin + saved.url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(saved.url.searchParams.get("scope")).toBe("openid email profile"); expect(saved.url.searchParams.get("nonce")).toBe(saved.nonce);
    expect(saved.url.searchParams.get("code_challenge_method")).toBe("S256"); expect(saved.url.searchParams.get("prompt")).toBe("select_account");
    const verifier = String(db.prepare("SELECT code_verifier FROM oauth_states").all()[0]!.code_verifier);
    expect(saved.url.searchParams.get("code_challenge")).toBe(base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))));
    const fetcher = googleFetch(await token(saved.nonce)); await call(`/api/auth/google/callback?state=${saved.state}&code=normal-code`);
    const request = fetcher.mock.calls.find(([url]) => String(url) === "https://oauth2.googleapis.com/token")!;
    const body = new URLSearchParams(String((request as unknown as [string, RequestInit])[1]?.body));
    expect(body.get("code_verifier")).toBe(verifier); expect(body.get("redirect_uri")).toBe("https://app.example.com/api/auth/google/callback");
  });

  it("개발 HTTP는 Host 접두사와 Secure 없이 별도 cookie 이름을 쓴다", async () => {
    const { env, start } = await setup(); env.APP_ENV = "development";
    const saved = await start(); expect(saved.cookies[0]).toMatch(/^google-oauth-/); expect(saved.cookies[0]).not.toContain("Secure");
    expect(saved.cookies[0]).toContain("HttpOnly"); expect(saved.cookies[0]).toContain("SameSite=Lax");
  });

  it("다른 브라우저의 callback은 로그인시키거나 원래 브라우저의 state를 소모하지 않는다", async () => {
    const { db, call, start } = await setup(true); const saved = await start();
    const fetcher = googleFetch(await token(saved.nonce));
    const callback = `/api/auth/google/callback?state=${saved.state}&code=attacker-code`;
    const foreign = await call(callback, { headers: { cookie: "" } });
    expect(targetOf(foreign).searchParams.get("error")).toBe("google_state");
    expect(fetcher).not.toHaveBeenCalled(); expect(db.prepare("SELECT * FROM sessions").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM oauth_states WHERE state=?").all(saved.state)).toHaveLength(1);
    expect((await call(callback)).headers.get("location")).toBe(INVITE);
    expect(db.prepare("SELECT * FROM sessions").all()).toHaveLength(1);
  });

  it("다른 nonce·탭의 cookie로는 유효 state를 지우거나 저장된 invite next를 노출하지 않는다", async () => {
    const { db, call, start } = await setup(true); const a = await start(), b = await start("/dashboard");
    const fetcher = googleFetch(await token(a.nonce)), name = a.cookies[0]!.split("=", 1)[0]!;
    for (const nonce of ["A".repeat(32), b.nonce]) {
      const response = await call(`/api/auth/google/callback?state=${a.state}&code=foreign`, { headers: { cookie: `${name}=${nonce}` } });
      expect(targetOf(response).searchParams.get("error")).toBe("google_state"); expect(targetOf(response).searchParams.get("next")).toBe("/dashboard");
    }
    expect(db.prepare("SELECT * FROM oauth_states").all()).toHaveLength(2); expect(fetcher).not.toHaveBeenCalled();
    expect((await call(`/api/auth/google/callback?state=${a.state}&code=normal`)).headers.get("location")).toBe(INVITE);
  });

  it("동시 callback도 state를 한 번만 소모하고 token 교환·세션 생성을 한 번만 한다", async () => {
    const { db, call, start, setAfterStateRead } = await setup(true);
    db.exec("UPDATE users SET google_sub='google-user'");
    const saved = await start(), fetcher = googleFetch(await token(saved.nonce));
    let reads = 0, release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    setAfterStateRead(async () => { if (++reads === 2) release(); await gate; });
    const results = await Promise.all([call(`/api/auth/google/callback?state=${saved.state}&code=code-one`), call(`/api/auth/google/callback?state=${saved.state}&code=code-two`)]);
    expect(results.filter((response) => response.headers.get("location") === INVITE)).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url) === "https://oauth2.googleapis.com/token")).toHaveLength(1);
    expect(db.prepare("SELECT * FROM sessions").all()).toHaveLength(1);
  });

  it("여러 탭의 cookie는 독립적이고 취소는 해당 탭만 정리하며 다른 탭·replay를 로그인시키지 않는다", async () => {
    const { db, call, start, cookies } = await setup(true); const a = await start(), b = await start("/dashboard?tab=two");
    const nameA = a.cookies[0]!.split("=", 1)[0]!, nameB = b.cookies[0]!.split("=", 1)[0]!;
    expect(nameA).not.toBe(nameB); expect(cookies.has(nameA) && cookies.has(nameB)).toBe(true);
    const fetcher = googleFetch(await token(b.nonce));
    const cancelled = await call(`/api/auth/google/callback?state=${a.state}&error=access_denied&code=ignored`);
    expect(targetOf(cancelled).searchParams.get("error")).toBe("google_cancelled"); expect(targetOf(cancelled).searchParams.get("next")).toBe(INVITE);
    expect(cookies.has(nameA)).toBe(false); expect(cookies.has(nameB)).toBe(true); expect(fetcher).not.toHaveBeenCalled();
    const response = await call(`/api/auth/google/callback?state=${b.state}&code=normal`); expect(response.headers.get("location")).toBe("/dashboard?tab=two");
    expect(cookies.has(nameB)).toBe(false); const count = fetcher.mock.calls.length;
    const replay = await call(`/api/auth/google/callback?state=${b.state}&code=replay`, { headers: { cookie: b.cookies[0]!.split(";", 1)[0]! } });
    expect(targetOf(replay).searchParams.get("error")).toBe("google_state"); expect(fetcher.mock.calls).toHaveLength(count);
    expect(db.prepare("SELECT * FROM sessions").all()).toHaveLength(1);
  });

  it("인증 TTL 경계에서 거절하되 원래 브라우저의 만료 안내 유예 동안 invite next를 보존한다", async () => {
    const { db, call, start } = await setup(); const saved = await start();
    vi.mocked(Date.now).mockReturnValue(NOW + 10 * 60_000);
    const other = await start("/dashboard"); // 다른 시작이 유예 중 state를 삭제하지 않는다.
    const fetcher = googleFetch(""); const response = await call(`/api/auth/google/callback?state=${saved.state}&code=expired`);
    expect(targetOf(response).searchParams.get("error")).toBe("google_state"); expect(targetOf(response).searchParams.get("next")).toBe(INVITE);
    expect(fetcher).not.toHaveBeenCalled(); expect(db.prepare("SELECT state FROM oauth_states").all()).toEqual([{ state: other.state }]);
  });

  it("취소·잘못된 callback은 기존 로그인 cookie와 세션 행을 유지한다", async () => {
    const { db, call, start, cookies } = await setup(); const existing = await sha256Hex("existing-login");
    db.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,'u1',?,?)").run(existing, NOW + 3_600_000, NOW);
    cookies.set("sid", "existing-login"); const before = db.prepare("SELECT * FROM sessions").all(), saved = await start();
    const invalid = await call(`/api/auth/google/callback?state=${saved.state}&code=other-browser`, { headers: { cookie: "sid=existing-login" } });
    expect(targetOf(invalid).searchParams.get("error")).toBe("google_state");
    const cancelled = await call(`/api/auth/google/callback?state=${saved.state}&error=access_denied`);
    expect(cancelled.headers.getSetCookie().every((cookie) => !cookie.startsWith("sid="))).toBe(true);
    expect(cookies.get("sid")).toBe("existing-login"); expect(db.prepare("SELECT * FROM sessions").all()).toEqual(before);
  });

  it.each(["provider", "start_db", "callback_db"])("%s 원문 code/state/nonce/token/SQL cause는 응답·로그에 남기지 않는다", async (stage) => {
    const { db, call, start, setBeforeQuery } = await setup(true);
    const saved = stage === "start_db" ? null : await start(), fetcher = googleFetch("private-id-token");
    if (stage === "provider") fetcher.mockResolvedValueOnce(new Response("private-code private-id-token private-cookie", { status: 400 }));
    else setBeforeQuery((sql) => {
      if ((stage === "start_db" && /^insert into "oauth_states"/i.test(sql)) || (stage === "callback_db" && /^delete from "oauth_states"/i.test(sql) && sql.includes('"nonce"'))) throw new Error(`private-code private-id-token private-cookie ${saved?.state ?? "private-state"} ${saved?.nonce ?? "private-nonce"}`, { cause: new Error("private-cause") });
    });
    const response = stage === "start_db" ? await call(`/api/auth/google/start?next=${encodeURIComponent(INVITE)}`) : await call(`/api/auth/google/callback?state=${saved!.state}&code=private-code`);
    expect(targetOf(response).searchParams.get("error")).toBe("google_failed");
    const output = JSON.stringify(vi.mocked(console.error).mock.calls) + response.headers.get("location");
    for (const secret of ["private-code", "private-id-token", "private-cookie", "private-cause", saved?.state, saved?.nonce]) if (secret) expect(output).not.toContain(secret);
    expect(db.prepare("SELECT * FROM sessions").all()).toHaveLength(0);
    if (stage === "callback_db") expect(db.prepare("SELECT * FROM oauth_states").all()).toHaveLength(1);
  });
});

describe("Google 로그인으로 팀 초대 이어가기", () => {
  it("인증된 계정은 초대로 복귀하고 수락 버튼의 POST 전에는 가입시키지 않는다", async () => {
    const { db, call, start } = await setup(true);
    const saved = await start();
    expect(saved.next).toBe(INVITE);
    googleFetch(await token(saved.nonce));
    const callback = await call(`/api/auth/google/callback?state=${saved.state}&code=google-code`);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(INVITE);
    expect(db.prepare("SELECT * FROM members").all()).toHaveLength(0);
    expect(db.prepare("SELECT accepted_at FROM invites").all()[0]?.accepted_at).toBeNull();
    const accepted = await call("/api/invites/invite-token/accept", { method: "POST", headers: { cookie: sessionCookie(callback) } });
    expect(accepted.status).toBe(200);
    expect(db.prepare("SELECT workspace_id, user_id, role FROM members").all()).toEqual([{ workspace_id: "w1", user_id: "u1", role: "editor" }]);
  });

  it("미인증 계정은 초대 next를 유지한 채 번호 인증으로 가고 인증 후에만 수락할 수 있다", async () => {
    const { db, call, start } = await setup();
    const saved = await start();
    googleFetch(await token(saved.nonce));
    const callback = await call(`/api/auth/google/callback?state=${saved.state}&code=google-code`);
    expect(targetOf(callback).pathname).toBe("/verify-phone");
    expect(targetOf(callback).searchParams.get("next")).toBe(INVITE);
    const init = { method: "POST", headers: { cookie: sessionCookie(callback) } };
    expect((await call("/api/invites/invite-token/accept", init)).status).toBe(403);
    expect(db.prepare("SELECT * FROM members").all()).toHaveLength(0);
    db.prepare("UPDATE users SET phone_verified_at = ? WHERE id = 'u1'").run(NOW);
    expect((await call("/api/invites/invite-token/accept", init)).status).toBe(200);
  });

  it("Google 신규 가입도 별도 워크스페이스나 초대 수락 없이 번호 인증으로 이어진다", async () => {
    const { db, call, start } = await setup();
    db.exec("DELETE FROM users WHERE id = 'u1'");
    const saved = await start();
    googleFetch(await token(saved.nonce));
    const callback = await call(`/api/auth/google/callback?state=${saved.state}&code=google-code`);
    expect(targetOf(callback).pathname).toBe("/verify-phone");
    expect(targetOf(callback).searchParams.get("next")).toBe(INVITE);
    expect(db.prepare("SELECT email, google_sub, phone_verified_at FROM users").all()).toEqual([{ email: "invited@example.com", google_sub: "google-user", phone_verified_at: null }]);
    expect(db.prepare("SELECT * FROM sessions").all()).toHaveLength(1);
    expect(db.prepare("SELECT * FROM workspaces").all()).toHaveLength(1);
    expect(db.prepare("SELECT * FROM members").all()).toHaveLength(0);
  });

  it.each(["cancelled", "http", "network", "json", "claims"])("%s 실패 뒤에도 초대 경로를 보존하고 세션을 만들지 않는다", async (failure) => {
    const { db, call, start } = await setup();
    const saved = await start();
    const fetcher = googleFetch(await token(saved.nonce, failure === "claims" ? { nonce: "wrong" } : {}));
    if (failure === "network") fetcher.mockRejectedValue(new TypeError("network failure"));
    if (failure === "http") fetcher.mockResolvedValue(new Response("bad token", { status: 400 }));
    if (failure === "json") fetcher.mockResolvedValue(new Response("invalid json"));
    const response = await call(`/api/auth/google/callback?state=${saved.state}${failure === "cancelled" ? "&error=access_denied" : "&code=google-code"}`);
    expect(response.status).toBe(302);
    expect(targetOf(response).pathname).toBe("/login");
    expect(targetOf(response).searchParams.get("error")).toBe(failure === "cancelled" ? "google_cancelled" : "google_failed");
    expect(targetOf(response).searchParams.get("next")).toBe(INVITE);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.getSetCookie()[0]).toMatch(/^__Host-google-oauth-.*Max-Age=0/);
    expect(db.prepare("SELECT * FROM sessions").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM members").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM oauth_states").all()).toHaveLength(0);
  });

  it("이메일 소유가 확인되지 않은 기존 계정은 초대를 유지한 실패 화면으로 보낸다", async () => {
    const { db, call, start } = await setup();
    const saved = await start();
    googleFetch(await token(saved.nonce, { email_verified: false }));
    const response = await call(`/api/auth/google/callback?state=${saved.state}&code=google-code`);
    expect(targetOf(response).searchParams.get("error")).toBe("google_email_unverified");
    expect(targetOf(response).searchParams.get("next")).toBe(INVITE);
    expect(db.prepare("SELECT * FROM sessions").all()).toHaveLength(0);
  });

  it("만료된 OAuth 요청은 복귀 주소만 복구하고 로그인은 허용하지 않는다", async () => {
    const { db, call, start } = await setup();
    const saved = await start();
    db.prepare("UPDATE oauth_states SET created_at = ?").run(NOW - 10 * 60_000 - 1);
    const fetcher = googleFetch("");
    const response = await call(`/api/auth/google/callback?state=${saved.state}&code=google-code`);
    expect(targetOf(response).searchParams.get("error")).toBe("google_state");
    expect(targetOf(response).searchParams.get("next")).toBe(INVITE);
    expect(fetcher).not.toHaveBeenCalled();
    expect(db.prepare("SELECT * FROM sessions").all()).toHaveLength(0);
  });

  it("설정이 없거나 state가 없어도 안전한 복귀 주소만 보낸다", async () => {
    const { call, env, start } = await setup();
    const response = await call(`/api/auth/google/start?next=${encodeURIComponent(INVITE)}`, undefined, { ...env, GOOGLE_CLIENT_SECRET: undefined });
    expect(targetOf(response).searchParams.get("error")).toBe("google_disabled");
    expect(targetOf(response).searchParams.get("next")).toBe(INVITE);
    const unknown = await call("/api/auth/google/callback?state=unknown&next=//evil.example");
    expect(targetOf(unknown).searchParams.get("error")).toBe("google_state");
    expect(targetOf(unknown).searchParams.get("next")).toBe("/dashboard");
    const saved = await start();
    const disabled = await call(`/api/auth/google/callback?state=${saved.state}&code=google-code`, undefined, { ...env, GOOGLE_CLIENT_SECRET: undefined });
    expect(targetOf(disabled).searchParams.get("error")).toBe("google_disabled");
    expect(targetOf(disabled).searchParams.get("next")).toBe(INVITE);
  });

  it("시작 입력과 예전에 저장된 unsafe next를 모두 차단한다", async () => {
    const { db, call, start } = await setup(true);
    expect((await start("/\\evil.example")).next).toBe("/dashboard");
    const saved = await start();
    db.prepare("UPDATE oauth_states SET redirect_next = ? WHERE state = ?").run("/.//evil.example", saved.state);
    googleFetch(await token(saved.nonce));
    expect((await call(`/api/auth/google/callback?state=${saved.state}&code=google-code`)).headers.get("location")).toBe("/dashboard");
  });

  it.each(["email", "expired", "used"])("%s 초대에는 Google 로그인 뒤에도 멤버를 추가하지 않는다", async (reason) => {
    const { db, call, start } = await setup(true);
    if (reason === "email") db.exec("UPDATE invites SET email = 'other@example.com'");
    if (reason === "expired") db.prepare("UPDATE invites SET expires_at = ?").run(NOW - 1);
    if (reason === "used") db.prepare("UPDATE invites SET accepted_at = ?").run(NOW - 1);
    const saved = await start();
    googleFetch(await token(saved.nonce));
    const callback = await call(`/api/auth/google/callback?state=${saved.state}&code=google-code`);
    const accepted = await call("/api/invites/invite-token/accept", { method: "POST", headers: { cookie: sessionCookie(callback) } });
    expect(accepted.status).toBe(reason === "email" ? 403 : 410);
    expect(db.prepare("SELECT * FROM members").all()).toHaveLength(0);
  });
});
