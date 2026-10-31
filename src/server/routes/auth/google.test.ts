import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db";
import { ApiError, errorBody } from "../../lib/errors";
import { base64url } from "../../lib/ids";
import type { Jwk } from "../../lib/jwt";
import { loadSession } from "../../middleware/auth";
import { inviteRoutes } from "../invites";
import { googleRoutes } from "./google";

type Value = string | number | null;
type Row = Record<string, Value>;
type Sqlite = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): { run(...params: Value[]): { changes: number }; all(...params: Value[]): Row[] };
};
const databases: Sqlite[] = [];
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
  const sqlite = (await import("node:sqlite" as string)) as { DatabaseSync: new (path: string) => Sqlite };
  const fs = (await import("node:fs" as string)) as { readdirSync(path: string): string[]; readFileSync(path: string, encoding: string): string };
  const db = new sqlite.DatabaseSync(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of fs.readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort()) db.exec(fs.readFileSync(`migrations/${file}`, "utf8"));
  const prepare = (sql: string, params: Value[] = []): unknown => ({
    bind: (...values: Value[]) => prepare(sql, values),
    run: async () => ({ success: true, results: [], meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
    all: async () => ({ success: true, results: db.prepare(sql).all(...params), meta: {} }),
    raw: async () => {
      // D1.raw처럼 JOIN의 중복 컬럼 이름도 선택 순서대로 보존한다(Node 23 SQLite는 객체만 반환).
      const arraySql = sql.replace(/^select (.*?) from /i, "select json_array($1) as raw_row from ");
      return db.prepare(arraySql).all(...params).map((row) => JSON.parse(String(row.raw_row)));
    },
  });
  const d1 = { prepare, batch: async (statements: { run(): Promise<unknown> }[]) => {
    db.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      db.exec("COMMIT");
      return results;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } } as unknown as D1Database;
  db.prepare("INSERT INTO users (id, email, password_hash, name, created_at, phone_verified_at) VALUES ('u1', 'invited@example.com', '', '초대받은 사람', ?, ?)").run(NOW, phoneVerified ? NOW : null);
  db.exec("INSERT INTO workspaces (id, name, created_at) VALUES ('w1', '초대한 팀', 1)");
  db.prepare("INSERT INTO invites (id, workspace_id, email, role, token, expires_at, created_at) VALUES ('i1', 'w1', 'invited@example.com', 'editor', 'invite-token', ?, ?)").run(NOW + 60_000, NOW);
  const env = { DB: d1, APP_URL: "https://app.example.com", GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "test-secret" } as Env;
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", getDb(c.env.DB)); await next(); });
  app.use("*", loadSession);
  app.route("/api/auth", googleRoutes);
  app.route("/api/invites", inviteRoutes);
  app.onError((error, c) => error instanceof ApiError ? c.json(errorBody(error.code, error.message), error.status) : c.text("internal error", 500));
  const call = (path: string, init?: RequestInit, bindings = env) => app.request(path, init, bindings);
  const start = async (next = INVITE) => {
    const response = await call(`/api/auth/google/start?next=${encodeURIComponent(next)}`);
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("location")!);
    const state = target.searchParams.get("state")!;
    const saved = db.prepare("SELECT nonce, redirect_next FROM oauth_states WHERE state = ?").all(state)[0]!;
    return { state, nonce: String(saved.nonce), next: saved.redirect_next };
  };
  return { db, env, call, start };
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
const sessionCookie = (response: Response) => response.headers.get("set-cookie")!.split(";", 1)[0]!;

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
    expect(response.headers.get("set-cookie")).toBeNull();
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
