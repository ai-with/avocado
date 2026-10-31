import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createSqliteD1, type TestSqlite } from "../test/sqlite-d1";
import { getDb } from "../db";
import type { AppEnv } from "../types";
import { loadSession } from "../middleware/auth";
import { igRoutes } from "../routes/instagram";
import { ApiError, errorBody } from "./errors";
import { sha256Hex } from "./ids";
import { decryptToken } from "./crypto";
import { publicGuideInstagram } from "./instagram-oauth";
import { IG_SCOPES } from "../../shared/performance";

const NOW = 1_800_000_000_000;
const KEY = "instagram-test-encryption-key";
const dbs: TestSqlite[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); });
afterEach(() => { dbs.splice(0).forEach((db) => db.close()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

type Options = { who?: 1 | 2; cookie?: string; method?: string; headers?: Record<string, string> };
async function setup(production = true) {
  const { db, d1: native } = await createSqliteD1(); dbs.push(db);
  db.exec("INSERT INTO workspaces (id,name,created_at) VALUES ('w1','첫 브랜드',1),('w2','다른 브랜드',1)");
  for (let n = 1; n <= 2; n++) {
    db.prepare("INSERT INTO users (id,email,password_hash,name,phone_verified_at,created_at) VALUES (?,?, '', '테스트',?,1)").run(`u${n}`, `person${n}@example.test`, NOW);
    db.prepare("INSERT INTO members (workspace_id,user_id,role,created_at) VALUES (?,?,'owner',1)").run(`w${n}`, `u${n}`);
    db.prepare("INSERT INTO sessions (id,user_id,current_workspace_id,expires_at,created_at) VALUES (?,?,?,?,1)").run(await sha256Hex(`ig-session-${n}`), `u${n}`, `w${n}`, NOW + 3_600_000);
    db.prepare("INSERT INTO guides (id,workspace_id,name,slug,status,extra_rules,product,deliverables,secondary_use_scope,created_at,updated_at) VALUES (?,?,?,?,'published','[]','{}','{}','{}',1,1)").run(`g${n}`, `w${n}`, `가이드${n}`, `guide-${n}`);
    db.prepare("INSERT INTO influencers (id,workspace_id,display_name,created_at) VALUES (?,?,?,1)").run(`i${n}`, `w${n}`, `크리에이터${n}`);
    db.prepare("INSERT INTO guide_influencers (id,guide_id,influencer_id,guide_token,upload_token,feedback_token,connect_token,token_expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,1)")
      .run(`gi${n}`, `g${n}`, `i${n}`, `guide-token-${n}`, `upload-token-${n}`, `feedback-token-${n}`, `connect-token-${n}`, NOW + 3_600_000);
  }
  let hook: ((sql: string) => void) | undefined;
  const d1 = { ...native, prepare: (sql: string) => { hook?.(sql); return native.prepare(sql); } } as D1Database;
  const origin = production ? "https://app.example.test" : "http://localhost:8787";
  const env = { DB: d1, APP_ENV: production ? "production" : "development", APP_URL: origin, META_APP_ID: "fake-meta-client", META_APP_SECRET: "fake-meta-secret", TOKEN_ENC_KEY: KEY } as Env;
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", getDb(c.env.DB)); await next(); });
  app.use("*", loadSession); app.route("/api/ig", igRoutes);
  app.onError((error, c) => error instanceof ApiError ? c.json(errorBody(error.code, error.message), error.status) : c.text(String(error), 500));
  const call = (path: string, body?: unknown, options: Options = {}) => app.request(`${origin}/api/ig${path}`, {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    headers: { Origin: origin, "content-type": "application/json", cookie: [options.who ? `sid=ig-session-${options.who}` : "", options.cookie ?? ""].filter(Boolean).join("; "), ...options.headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const start = async (body: object = { target: "influencer", token: "connect-token-1", returnMode: "guide", lang: "en" }, who?: 1 | 2) => {
    const response = await call("/oauth/start", body, { who });
    expect(response.status, await response.clone().text()).toBe(200);
    const { authorizationUrl } = await response.json() as { authorizationUrl: string };
    const url = new URL(authorizationUrl), state = url.searchParams.get("state")!;
    const setCookie = response.headers.get("set-cookie")!, cookie = setCookie.split(";")[0]!;
    return { url, state, cookie, setCookie, callback: (query = "code=fake-code", options: Options = {}) => call(`/oauth/callback?state=${state}&${query}`, undefined, { cookie, who, ...options }) };
  };
  const client = (expires: number | null = NOW + 3_600_000) => db.prepare("INSERT INTO ig_connections (id,workspace_id,target,scopes,connect_token,connect_expires_at,generation,created_at) VALUES ('client','w1','client_brand','[]','client-token-1',?,'client-generation',1)").run(expires);
  return { db, env, call, start, client, orm: getDb(d1), setHook: (fn?: (sql: string) => void) => { hook = fn; } };
}

function provider(options: { scopes?: string[] | null; accountType?: string; onMe?: () => void } = {}) {
  const scopes = options.scopes === undefined ? IG_SCOPES.influencer : options.scopes;
  const grants = scopes ? { permissions: scopes } : {};
  const mock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://api.instagram.com/oauth/access_token") return Response.json({ access_token: "short-test-token", user_id: "12345", ...grants });
    if (url.startsWith("https://graph.instagram.com/access_token?")) return Response.json({ access_token: "long-test-token", token_type: "bearer", expires_in: 3600, ...grants });
    if (url.includes("/me?")) { options.onMe?.(); return Response.json({ user_id: "12345", username: "test_creator", account_type: options.accountType ?? "BUSINESS" }); }
    throw new Error("unexpected_provider_request");
  });
  vi.stubGlobal("fetch", mock); return mock;
}
const location = (response: Response) => response.headers.get("location")!;
const connection = (db: TestSqlite) => db.prepare("SELECT * FROM ig_connections WHERE target='influencer'").all()[0]!;

describe("Instagram OAuth의 실제 SQLite state·브라우저·가이드 경계", () => {
  it("최소 요청범위와 해시 state/nonce를 쓰고 실제 grant·암호화 토큰 저장 후 같은 가이드/언어로 돌아온다", async () => {
    const { db, start, call } = await setup(); const mock = provider({ scopes: [...IG_SCOPES.influencer, "instagram_business_manage_comments"] });
    const flow = await start();
    expect(flow.url.origin).toBe("https://www.instagram.com");
    expect(flow.url.searchParams.get("scope")?.split(",")).toEqual(IG_SCOPES.influencer);
    expect(flow.state).toMatch(/^[\w-]{32,128}$/);
    const stored = db.prepare("SELECT * FROM ig_oauth_states").all()[0]!;
    expect(stored.state_hash).toBe(await sha256Hex(flow.state)); expect(stored.nonce_hash).toBe(await sha256Hex(flow.cookie.slice(flow.cookie.indexOf("=") + 1)));
    expect(stored.connect_token_hash).toBe(await sha256Hex("connect-token-1")); expect(stored.guide_token_hash).toBe(await sha256Hex("guide-token-1"));
    expect(flow.setCookie).toMatch(/^__Host-ig-oauth-/); expect(flow.setCookie).toContain("Path=/"); expect(flow.setCookie).toContain("Secure");
    expect(flow.setCookie).toContain("HttpOnly"); expect(flow.setCookie).toContain("SameSite=Lax"); expect(flow.setCookie).toContain("Max-Age=900");
    const response = await flow.callback(); expect(response.status).toBe(302); expect(location(response)).toBe("/g/guide-token-1?lang=en&ig=connected&done=1");
    const row = connection(db); expect(row.token_enc).not.toBe("long-test-token"); expect(await decryptToken(KEY, String(row.token_enc))).toBe("long-test-token");
    expect(row.grants_verified_at).toBe(NOW); expect(JSON.parse(String(row.scopes))).toContain("instagram_business_manage_comments");
    expect(row.generation).not.toBe(stored.connection_generation); expect(row.disconnected_at).toBeNull();
    const info = await (await call("/connect/connect-token-1?returnMode=guide&lang=en")).json(); expect(info).toMatchObject({ connected: true, returnUrl: "/g/guide-token-1?lang=en" });
    expect(JSON.stringify(info)).not.toMatch(/long-test-token|short-test-token|fake-meta-secret|token_enc/);
    expect(JSON.stringify(db.prepare("SELECT name,props FROM events").all())).not.toMatch(/long-test-token|short-test-token|fake-meta-secret/);
    expect(mock).toHaveBeenCalledTimes(3); await flow.callback(); expect(mock).toHaveBeenCalledTimes(3);
  });

  it("개발 HTTP에서는 비-Host nonce 쿠키와 실제 요청 Origin을 사용하고 운영 fake OAuth는 비활성이다", async () => {
    const { start, call, env } = await setup(false); provider(); const flow = await start();
    expect(flow.setCookie).toMatch(/^ig-oauth-/); expect(flow.setCookie).not.toContain("Secure");
    expect((await call("/oauth/start", { target: "influencer", token: "connect-token-1" }, { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    env.APP_ENV = "production"; env.IG_FAKE = "1";
    expect((await call("/oauth/start", { target: "influencer", token: "connect-token-1" })).status).toBe(503);
    expect((await call("/oauth/start?target=influencer&token=connect-token-1")).status).toBe(404);
  });

  it("로컬 fake는 APP_URL의 운영 주소 대신 요청 origin의 DB·nonce로 복귀한다", async () => {
    const { start, env } = await setup(false); env.APP_URL = "https://production.example.test"; env.IG_FAKE = "1";
    const mock = vi.fn(); vi.stubGlobal("fetch", mock); const flow = await start();
    expect(flow.url.origin).toBe("http://localhost:8787"); expect(flow.url.pathname).toBe("/api/ig/oauth/callback");
    expect(flow.url.searchParams.get("code")).toBe("fake");
    expect(location(await flow.callback())).toContain("/g/guide-token-1?lang=en&ig=connected"); expect(mock).not.toHaveBeenCalled();
  });

  it("다른 브라우저·잘못된 nonce는 피해자의 복귀 capability를 노출하거나 provider를 호출하지 않는다", async () => {
    const { start, call, db } = await setup(); const mock = provider(); const flow = await start();
    for (const cookie of ["", `${flow.cookie.split("=")[0]}=wrong`]) {
      const response = await call(`/oauth/callback?state=${flow.state}&code=stolen`, undefined, { cookie });
      expect(location(response)).toBe("/connect/invalid?ig=failed&error=invalid_state");
      expect(location(response)).not.toMatch(/guide-token-1|connect-token-1/);
    }
    expect(mock).not.toHaveBeenCalled(); expect(db.prepare("SELECT used_at FROM ig_oauth_states").all()[0]?.used_at).toBeNull();
    expect(location(await flow.callback())).toContain("ig=connected");
  });

  it.each(["cancel", "expired", "network"])("%s 실패도 원래 가이드·언어에 돌아가고 기존 자격증명을 만들지 않는다", async (kind) => {
    const { start, db } = await setup(); const mock = provider(); const flow = await start();
    if (kind === "expired") db.exec("UPDATE ig_oauth_states SET expires_at=1");
    if (kind === "network") mock.mockRejectedValueOnce(new Error("network"));
    const response = await flow.callback(kind === "cancel" ? "error=access_denied" : undefined);
    expect(location(response)).toContain("/g/guide-token-1?lang=en&ig=");
    expect(location(response)).toContain(kind === "cancel" ? "ig=cancelled&error=denied" : "ig=failed");
    expect(connection(db).connected_at).toBeNull(); expect(connection(db).grants_verified_at).toBeNull();
    if (kind !== "network") expect(mock).not.toHaveBeenCalled();
  });

  it("공급자 원문 오류 대신 정규화한 사유만 복귀 URL·분석 이벤트에 남긴다", async () => {
    const { start, db } = await setup(); const mock = provider();
    mock.mockResolvedValueOnce(Response.json({ error: { code: 190, message: "fake-meta-secret short-test-token private-auth-code" } }, { status: 400 }));
    const response = await (await start()).callback(); expect(location(response)).toContain("error=token_expired");
    const audit = db.prepare("SELECT props FROM events WHERE name='ig_connect_failed'").all();
    expect(audit).toHaveLength(1); expect(JSON.parse(String(audit[0]?.props))).toEqual({ reason: "token_expired", target: "influencer" });
    expect(location(response) + JSON.stringify(audit)).not.toMatch(/fake-meta-secret|short-test-token|private-auth-code/);
  });

  it("각 탭에 별도 nonce를 부여하고 같은 연결의 먼저 성공한 세대만 저장한다", async () => {
    const { start, db } = await setup(); const mock = provider(); const a = await start(), b = await start();
    expect(a.cookie.split("=")[0]).not.toBe(b.cookie.split("=")[0]);
    expect(db.prepare("SELECT id FROM ig_connections").all()).toHaveLength(1);
    expect(location(await a.callback())).toContain("ig=connected");
    expect(location(await b.callback())).toContain("error=stale_request"); expect(mock).toHaveBeenCalledTimes(3);
  });

  it("구 worker의 동일 generation token/grant/해제 UPDATE를 DB가 거절하고 새 OAuth는 정상 저장한다", async () => {
    const { db, start } = await setup(); provider();
    expect(location(await (await start()).callback())).toContain("ig=connected");
    const before = connection(db);
    for (const change of ["token_enc='unverified-old-worker-token'", "token_enc=NULL", "scopes='[]'", "grants_verified_at=NULL", "revoked_at=2", "disconnected_at=2"]) {
      expect(() => db.exec(`UPDATE ig_connections SET ${change} WHERE target='influencer'`)).toThrow(/generation/i);
      expect(connection(db)).toEqual(before);
    }
    expect(() => db.exec("UPDATE ig_connections SET token_enc=token_enc,scopes=scopes,grants_verified_at=grants_verified_at")).not.toThrow();
    expect(location(await (await start()).callback())).toContain("ig=connected");
    expect(connection(db).generation).not.toBe(before.generation); expect(connection(db).grants_verified_at).toBe(NOW);
  });

  it("구 worker의 증명 없는 최초 token INSERT는 거절하고 token 없는 placeholder는 허용한다", async () => {
    const { db } = await setup();
    expect(() => db.exec("INSERT INTO ig_connections(id,workspace_id,target,scopes,token_enc,created_at) VALUES('old-insert','w1','brand_sender','[]','old-worker-test-token',1)")).toThrow(/proof/i);
    expect(() => db.exec("INSERT INTO ig_connections(id,workspace_id,target,scopes,token_enc,generation,created_at) VALUES('unverified-insert','w1','brand_sender','[]','old-worker-test-token','some-generation',1)")).toThrow(/proof/i);
    expect(() => db.exec("INSERT INTO ig_connections(id,workspace_id,target,scopes,token_enc,created_at) VALUES('placeholder','w1','brand_sender','[]',NULL,1)")).not.toThrow();
    expect(db.prepare("SELECT id,token_enc,grants_verified_at FROM ig_connections").all()).toEqual([{ id: "placeholder", token_enc: null, grants_verified_at: null }]);
  });

  it.each(["start", "read_state", "claim"])("%s DB 오류의 capability·SQL params·cause를 로그나 응답으로 전달하지 않는다", async (stage) => {
    const { call, start, setHook } = await setup(); const mock = provider();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const flow = stage === "start" ? null : await start();
    setHook((sql) => {
      if ((stage === "start" && sql.startsWith("INSERT INTO ig_oauth_states")) || (stage === "read_state" && sql.startsWith("SELECT state_hash")) || (stage === "claim" && sql.startsWith("UPDATE ig_oauth_states SET used_at="))) {
        throw new Error("fake SQL params: guide-token-1 connect-token-1 private-provider-token", { cause: new Error("private-cause") });
      }
    });
    const response = stage === "start" ? await call("/oauth/start", { target: "influencer", token: "connect-token-1", returnMode: "guide" }) : await flow!.callback();
    if (stage === "start") { expect(response.status).toBe(503); expect(await response.clone().json()).toMatchObject({ error: { code: "oauth_unavailable" } }); }
    else { expect(response.status).toBe(302); expect(location(response)).toBe("/connect/invalid?ig=failed&error=api_error"); }
    expect((await response.text()) + (location(response) ?? "") + JSON.stringify(log.mock.calls)).not.toMatch(/guide-token-1|connect-token-1|private-provider-token|private-cause|fake SQL/);
    expect(log).toHaveBeenCalledTimes(1); expect(mock).not.toHaveBeenCalled();
  });

  it("같은 callback의 동시 실행도 state를 한 번만 claim하고 provider 교환을 한 번만 실행한다", async () => {
    const { start } = await setup(); const mock = provider(); const flow = await start();
    const results = await Promise.all([flow.callback(), flow.callback()]);
    expect(results.filter((r) => location(r).includes("ig=connected"))).toHaveLength(1);
    expect(results.filter((r) => location(r).includes("ig=failed"))).toHaveLength(1); expect(mock).toHaveBeenCalledTimes(3);
  });

  it("state claim 직전 토큰 재발급도 원자 predicate로 차단해 provider를 부르지 않는다", async () => {
    const { start, db, setHook } = await setup(); const mock = provider(); const flow = await start();
    setHook((sql) => { if (/^UPDATE ig_oauth_states SET used_at=/.test(sql)) { setHook(); db.exec("UPDATE guide_influencers SET connect_token='reissued-connect-token' WHERE id='gi1'"); } });
    expect(location(await flow.callback())).toContain("error=stale_request"); expect(mock).not.toHaveBeenCalled();
    expect(db.prepare("SELECT used_at FROM ig_oauth_states").all()[0]?.used_at).toBeNull();
  });

  it.each(["//evil.example/path", "/\\evil.example/path", "/g/guide-token-1?next=https://evil.example", "/dashboard/settings/integrations?next=//evil.example"])("저장된 복귀 경로도 URL allowlist로 제한한다: %s", async (path) => {
    const { db, start } = await setup(); provider(); const flow = await start();
    db.prepare("UPDATE ig_oauth_states SET return_path=?").run(path);
    const back = location(await flow.callback("error=access_denied"));
    expect(back).not.toContain("evil.example"); expect(back).not.toContain("next="); expect(back).toMatch(/^\/(connect\/invalid|g\/guide-token-1|dashboard\/settings\/integrations)\?/);
  });

  it.each(["expired", "draft", "wrong_target", "wrong_workspace"])("공개 링크의 %s 경계를 검증한다", async (kind) => {
    const { db, call } = await setup();
    if (kind === "expired") db.exec("UPDATE guide_influencers SET token_expires_at=1 WHERE id='gi1'");
    if (kind === "draft") db.exec("UPDATE guides SET status='draft' WHERE id='g1'");
    if (kind === "wrong_workspace") db.exec("UPDATE influencers SET workspace_id='w2' WHERE id='i1'");
    const response = await call("/oauth/start", { target: kind === "wrong_target" ? "client_brand" : "influencer", token: "connect-token-1" });
    expect(response.status).toBe(kind === "wrong_target" ? 400 : kind === "wrong_workspace" ? 404 : 410);
    expect(db.prepare("SELECT * FROM ig_oauth_states").all()).toHaveLength(0);
  });

  it("가이드 재발급 시 이전 GET 결과에서 새 connect capability를 반환하지 않는다", async () => {
    const { db, orm, env } = await setup();
    expect(await publicGuideInstagram(orm, env, "gi1", "en", "guide-token-1")).toMatchObject({ connectUrl: "/connect/connect-token-1?returnMode=guide&lang=en", connected: false });
    db.exec("UPDATE guide_influencers SET guide_token='new-guide-token',connect_token='new-connect-token' WHERE id='gi1'");
    await expect(publicGuideInstagram(orm, env, "gi1", "en", "guide-token-1")).rejects.toMatchObject({ code: "connect_link_expired" });
  });

  it.each(["before", "during", "final_sql"])("connect/guide 토큰이 %s에 재발급되면 새 연결을 저장하지 않는다", async (when) => {
    const { db, start, setHook } = await setup(); const change = () => db.exec("UPDATE guide_influencers SET guide_token='new-guide-token',connect_token='new-connect-token' WHERE id='gi1'");
    const mock = provider({ onMe: when === "during" ? change : undefined }); const flow = await start();
    if (when === "before") change();
    if (when === "final_sql") setHook((sql) => { if (/^UPDATE ig_connections SET generation=/.test(sql)) { setHook(); change(); } });
    const response = await flow.callback(); expect(location(response)).toContain("error=stale_request");
    expect(location(response)).not.toMatch(/new-guide-token|new-connect-token/); expect(connection(db).connected_at).toBeNull();
    if (when === "before") expect(mock).not.toHaveBeenCalled();
  });

  it.each(["logout", "other_user", "other_session", "during_expiry"])("공개 흐름도 시작 때 로그인한 actor의 %s를 거절한다", async (kind) => {
    const { db, start } = await setup(); const mock = provider({ onMe: kind === "during_expiry" ? () => db.exec("UPDATE sessions SET expires_at=1 WHERE user_id='u1'") : undefined });
    const flow = await start(undefined, 1);
    if (kind === "other_session") {
      db.prepare("INSERT INTO sessions (id,user_id,current_workspace_id,expires_at,created_at) VALUES (?,'u1','w1',?,1)").run(await sha256Hex("other-session"), NOW + 3_600_000);
    }
    const response = await flow.callback(undefined, kind === "logout" ? { who: undefined } : kind === "other_user" ? { who: 2 } : kind === "other_session" ? { who: undefined, cookie: `${flow.cookie}; sid=other-session` } : {});
    expect(location(response)).toContain("ig=failed"); expect(connection(db).connected_at).toBeNull();
    if (kind !== "during_expiry") expect(mock).not.toHaveBeenCalled();
  });

  it.each(["missing", "insufficient", "personal"])("%s grant/계정은 성공·요청범위 추정 저장 없이 거절한다", async (kind) => {
    const { start, db } = await setup(); provider({ scopes: kind === "missing" ? null : kind === "insufficient" ? ["instagram_business_basic"] : undefined, accountType: kind === "personal" ? "PERSONAL" : undefined });
    const response = await (await start()).callback();
    expect(location(response)).toContain(`error=${kind === "personal" ? "personal_account" : "grant_unverified"}`);
    expect(connection(db).grants_verified_at).toBeNull(); expect(connection(db).scopes).toBe("[]"); expect(connection(db).token_enc).toBeNull();
  });

  it.each(["unknown", "expired", "valid"])("client-brand 링크 TTL %s는 가이드 토큰과 분리 검증된다", async (kind) => {
    const { client, call, start } = await setup(); client(kind === "unknown" ? null : kind === "expired" ? 1 : undefined);
    const body = { target: "client_brand", token: "client-token-1", returnMode: "connect", lang: "en" };
    if (kind !== "valid") { expect((await call("/oauth/start", body)).status).toBe(410); return; }
    provider({ scopes: IG_SCOPES.client_brand }); const flow = await start(body);
    expect(location(await flow.callback())).toBe("/connect/client-token-1?lang=en&returnMode=connect&ig=connected&done=1");
  });

  it.each(["manual", "automatic", "newer_connection"])("%s generation 변경은 진행 중인 오래된 callback 복원을 막는다", async (kind) => {
    const { db, start, call } = await setup();
    provider({ onMe: () => db.exec(`UPDATE ig_connections SET generation='new-generation', ${kind === "newer_connection" ? "connected_at=2,username='newer_account'" : "token_enc=NULL,disconnected_at=2,disconnected_reason='provider_auth_invalid'"}`) });
    const flow = await start();
    if (kind === "manual") {
      const id = connection(db).id;
      expect((await call(`/connections/${id}`, undefined, { method: "DELETE", who: 1 })).status).toBe(200);
    }
    expect(location(await flow.callback())).toContain("error=stale_request");
    expect(connection(db).token_enc).toBeNull();
    if (kind === "newer_connection") expect(connection(db).username).toBe("newer_account");
  });
});

describe("브랜드 OAuth의 현재 권한과 원자적 최종 저장", () => {
  it("설정 목록도 최신 연결 시각·생성 시각·id 순으로 수동 해제된 최신 세대를 우선한다", async () => {
    const { db, call } = await setup();
    db.exec("INSERT INTO ig_connections(id,workspace_id,target,scopes,connected_at,created_at,generation,revoked_at,disconnected_at,disconnected_reason) VALUES ('older-active','w1','brand_sender','[]',10,100,'old',NULL,NULL,NULL),('latest-revoked','w1','brand_sender','[]',20,1,'new',20,20,'manual'),('latest-id-a','w1','brand_sender','[]',20,1,'tie-a',20,20,'manual'),('new-placeholder','w1','brand_sender','[]',NULL,200,'pending',NULL,NULL,NULL)");
    const body = await (await call("/connections", undefined, { who: 1 })).json() as { connections: { id: string; connected: boolean; disconnected: boolean }[] };
    expect(body.connections.map((row) => row.id)).toEqual(["latest-revoked", "latest-id-a", "older-active", "new-placeholder"]);
    expect(body.connections[0]).toMatchObject({ connected: false, disconnected: true });
  });

  it("새 고객사 요청 링크는 30일·해당 workspace에 묶이고 수동 해제는 옛 callback을 무효화한다", async () => {
    const { call, start, db } = await setup(); const mock = provider({ scopes: IG_SCOPES.client_brand });
    const response = await call("/connections/client-request", { label: "고객 브랜드" }, { who: 1 }); expect(response.status).toBe(201);
    const link = await response.json() as { id: string; connectUrl: string };
    const stored = db.prepare("SELECT * FROM ig_connections WHERE id=?").all(link.id)[0]!;
    expect(stored.connect_expires_at).toBe(NOW + 30 * 86_400_000); expect(stored.scopes).toBe("[]"); expect(stored.workspace_id).toBe("w1");
    const token = new URL(link.connectUrl).pathname.split("/").at(-1)!;
    const flow = await start({ target: "client_brand", token });
    expect((await call(`/connections/${link.id}`, undefined, { method: "DELETE", who: 2 })).status).toBe(404);
    expect((await call(`/connections/${link.id}`, undefined, { method: "DELETE", who: 1, headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect((await call(`/connections/${link.id}`, undefined, { method: "DELETE", who: 1 })).status).toBe(200);
    expect(location(await flow.callback())).toContain("error=stale_request"); expect(mock).not.toHaveBeenCalled();
    expect(db.prepare("SELECT connect_token FROM ig_connections WHERE id=?").all(link.id)[0]?.connect_token).toBeNull();
    expect((await call(`/connect/${token}`)).status).toBe(404);
  });

  it.each(["viewer", "unverified"])("시작 시 %s actor는 권한을 얻지 않는다", async (kind) => {
    const { db, call } = await setup();
    db.exec(kind === "viewer" ? "UPDATE members SET role='viewer' WHERE user_id='u1'" : "UPDATE users SET phone_verified_at=NULL WHERE id='u1'");
    expect((await call("/oauth/start", { target: "brand_sender" }, { who: 1 })).status).toBe(403);
    expect(db.prepare("SELECT * FROM ig_oauth_states").all()).toHaveLength(0);
  });

  it.each(["role", "session", "workspace", "phone", "expired"])("provider 교환 중 %s 변경을 최종 SQL에서 다시 검증한다", async (kind) => {
    const { db, start } = await setup();
    db.exec("INSERT INTO members (workspace_id,user_id,role,created_at) VALUES ('w2','u1','editor',2)");
    const changes: Record<string, string> = {
      role: "UPDATE members SET role='viewer' WHERE workspace_id='w1' AND user_id='u1'",
      session: "DELETE FROM sessions WHERE user_id='u1'",
      workspace: "UPDATE sessions SET current_workspace_id='w2' WHERE user_id='u1'",
      phone: "UPDATE users SET phone_verified_at=NULL WHERE id='u1'",
      expired: "UPDATE sessions SET expires_at=1 WHERE user_id='u1'",
    };
    provider({ scopes: IG_SCOPES.brand_sender, onMe: () => db.exec(changes[kind]!) });
    const flow = await start({ target: "brand_sender" }, 1);
    expect(location(await flow.callback())).toBe("/dashboard/settings/integrations?ig=failed&error=stale_request");
    expect(db.prepare("SELECT token_enc FROM ig_connections").all()[0]?.token_enc).toBeNull();
    if (kind === "workspace") expect(db.prepare("SELECT current_workspace_id FROM sessions WHERE user_id='u1'").all()[0]?.current_workspace_id).toBe("w2");
  });

  it("최종 DB 문장 직전 권한 회수도 저장을 막고 성공한 editor는 현재 브랜드에만 연결한다", async () => {
    const { db, start, setHook } = await setup(); provider({ scopes: IG_SCOPES.brand_sender });
    db.exec("UPDATE members SET role='editor' WHERE workspace_id='w1' AND user_id='u1'");
    const flow = await start({ target: "brand_sender" }, 1);
    setHook((sql) => { if (/^UPDATE ig_connections SET generation=/.test(sql)) { setHook(); db.exec("DELETE FROM members WHERE user_id='u1' AND workspace_id='w1'"); } });
    expect(location(await flow.callback())).toContain("error=stale_request");
    expect(db.prepare("SELECT token_enc FROM ig_connections").all()[0]?.token_enc).toBeNull();
    db.exec("INSERT INTO members (workspace_id,user_id,role,created_at) VALUES ('w1','u1','editor',1)");
    expect(location(await (await start({ target: "brand_sender" }, 1)).callback())).toContain("ig=connected");
    expect(db.prepare("SELECT workspace_id FROM ig_connections WHERE connected_at IS NOT NULL").all()).toEqual([{ workspace_id: "w1" }]);
  });

  it("provider 응답을 기다리는 사이 자연 세션 만료도 새 시각으로 검증한다", async () => {
    const { start, db } = await setup(); provider({ scopes: IG_SCOPES.brand_sender, onMe: () => vi.mocked(Date.now).mockReturnValue(NOW + 4_000_000) });
    const flow = await start({ target: "brand_sender" }, 1);
    expect(location(await flow.callback())).toContain("error=stale_request");
    expect(db.prepare("SELECT token_enc FROM ig_connections").all()[0]?.token_enc).toBeNull();
  });
});
