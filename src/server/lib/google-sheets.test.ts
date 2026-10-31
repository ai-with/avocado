import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createSqliteD1, type TestSqlite } from "../test/sqlite-d1";
import { getDb } from "../db";
import type { AppEnv, Auth } from "../types";
import { loadSession } from "../middleware/auth";
import { googleSheetsRoutes } from "../routes/google-sheets";
import { ApiError, errorBody } from "./errors";
import { encryptToken, decryptToken } from "./crypto";
import { newId, sha256Hex } from "./ids";
import { sheetsCsrf, sheetsAccessToken } from "./google-sheets-auth";
import { SHEETS_SCOPE } from "./google-sheets-provider";
import { cleanupGoogleSheetsJobs, sheetsExportValues } from "./google-sheets-export";
import { filteredLeads, lookups } from "../routes/leads/shared";
import { leadsCsv } from "../routes/leads/export";
import { parseCsv } from "../../shared/csv";
import { performanceCells, performanceCsv, performanceRows } from "../routes/performance";

const NOW = 1_800_000_000_000;
const KEY = "fake-sheets-encryption-key-for-tests";
const databases: TestSqlite[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); });
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
type JobResult = { id: string; status: string; spreadsheetUrl?: string; retryable: boolean; rows: number; errorCode: string | null };

async function setup() {
  const { db, d1 } = await createSqliteD1(); databases.push(db);
  db.exec("INSERT INTO workspaces (id,name,created_at) VALUES ('w1','첫 팀',1),('w2','다른 팀',1)");
  for (let n = 1; n <= 2; n++) {
    db.prepare("INSERT INTO users (id,email,password_hash,name,phone_verified_at,created_at) VALUES (?,?, '', '테스트',?,1)").run(`u${n}`, `user${n}@example.test`, NOW);
    db.prepare("INSERT INTO members (workspace_id,user_id,role,created_at) VALUES (?,?,'owner',1)").run(`w${n}`, `u${n}`);
    db.prepare("INSERT INTO sessions (id,user_id,current_workspace_id,expires_at,created_at) VALUES (?,?,?,?,1)").run(await sha256Hex(`test-session-${n}`), `u${n}`, `w${n}`, NOW + 3600_000);
    db.prepare("INSERT INTO guides (id,workspace_id,name,slug,extra_rules,product,deliverables,secondary_use_scope,created_at,updated_at) VALUES (?,?,?,?,'[]','{}','{}','{}',1,1)").run(`g${n}`, `w${n}`, `가이드${n}`, `guide${n}`);
    db.prepare("INSERT INTO influencers (id,workspace_id,display_name,created_at) VALUES (?,?,?,1)").run(`i${n}`, `w${n}`, `크리에이터${n}`);
    db.prepare("INSERT INTO guide_influencers (id,guide_id,influencer_id,guide_token,upload_token,feedback_token,connect_token,token_expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,1)")
      .run(`gi${n}`, `g${n}`, `i${n}`, `guide-${n}`, `upload-${n}`, `feedback-${n}`, `connect-${n}`, NOW + 3600_000);
    db.prepare("INSERT INTO contents (id,guide_id,influencer_id,guide_influencer_id,url,format,url_submitted_by,registered_at) VALUES (?,?,?,?,?,'reel','brand',1)").run(`content${n}`, `g${n}`, `i${n}`, `gi${n}`, `https://www.instagram.com/reel/TEST${n}/`);
  }
  const lead = (id: string, workspace = "w1", email = `${id}@example.test`, name = id) => {
    const source = JSON.stringify({ type: "manual", guideId: workspace === "w1" ? "g1" : "g2", influencerId: null, channelKey: null, linkId: null, at: NOW });
    db.prepare("INSERT INTO leads (id,workspace_id,email,name,answers,unsubscribe_token,first_source,last_source,created_at) VALUES (?,?,?,?,'{}',?,?,?,?)").run(id, workspace, email, name, `unsubscribe-${id}`, source, source, NOW);
  };
  lead("l1", "w1", "one@example.test", "=1+1"); lead("l2"); lead("foreign", "w2");
  db.exec("INSERT INTO metric_snapshots (id,content_id,offset_h,scheduled_at,status,missing,views,captured_at,path) VALUES ('snapshot','content1',24,1,'captured','{}',123,2,'connected')");
  const env = { DB: d1, APP_URL: "https://app.example.test", GOOGLE_CLIENT_ID: "fake-client", GOOGLE_CLIENT_SECRET: "fake-client-secret", TOKEN_ENC_KEY: KEY } as Env;
  const auth = async (n: number): Promise<Auth> => ({ sessionId: await sha256Hex(`test-session-${n}`), user: { id: `u${n}`, email: `user${n}@example.test`, name: "테스트" }, phone: null, phoneVerified: true, workspace: { id: `w${n}`, name: "팀", plan: "starter", onboardedAt: 1 }, role: "owner" });
  const orm = getDb(d1), app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", getDb(c.env.DB)); await next(); }); app.use("*", loadSession);
  app.route("/api/google-sheets", googleSheetsRoutes);
  app.onError((error, c) => error instanceof ApiError ? c.json(errorBody(error.code, error.message), error.status) : c.text(String(error), 500));
  const call = async (path: string, body?: unknown, who = 1, headers: Record<string, string> = {}) => app.request(`/api/google-sheets${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { cookie: `sid=test-session-${who}`, Origin: env.APP_URL, "X-CSRF-Token": (await sheetsCsrf(env, await auth(who)))!, "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(path === "/exports" ? { connectionGeneration: "generation", ...body as object } : body) }),
  }, env);
  const seedConnection = async (expires = NOW + 3600_000, user = "u1") => db.prepare("INSERT INTO google_sheets_connections (user_id,generation,access_enc,refresh_enc,scope,expires_at,connected_at,account_email) VALUES (?,'generation',?,?,?,?,?,'export@example.test')")
    .run(user, await encryptToken(KEY, "fake-access"), await encryptToken(KEY, "fake-refresh"), SHEETS_SCOPE, expires, NOW);
  return { db, d1, env, orm, call, seedConnection, auth, lead };
}

function provider() {
  const writes: { values: (string | number)[][] }[] = [];
  const mock = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "fake-access", refresh_token: "fake-refresh", token_type: "Bearer", expires_in: 3600, scope: SHEETS_SCOPE });
    if (url.startsWith("https://www.googleapis.com/drive/v3/about")) return Response.json({ user: { emailAddress: "export@example.test" } });
    if (url.startsWith("https://sheets.googleapis.com/v4/spreadsheets?")) return Response.json({ spreadsheetId: "test-sheet" });
    if (url.includes("/values/")) { writes.push(JSON.parse(String(init.body))); return Response.json({ updatedRows: writes.at(-1)!.values.length }); }
    throw new Error("예상하지 않은 외부 요청");
  });
  vi.stubGlobal("fetch", mock);
  return { mock, writes, creates: () => mock.mock.calls.filter(([url]) => url.startsWith("https://sheets.googleapis.com/v4/spreadsheets?")) };
}
const result = async (response: Response) => { expect(response.status).toBe(200); return await response.json() as JobResult; };

describe("앱 자체 Google Sheets 추가 동의", () => {
  it("drive.file만 요청하고 user/session/state/PKCE에 묶어 토큰을 암호화하며 연결 자체로 자료를 보내지 않는다", async () => {
    const { db, call } = await setup(); const { mock, creates } = provider();
    const start = await call("/connect", { returnTo: "/dashboard/leads?tagId=tag" });
    const { authorizationUrl } = await start.json() as { authorizationUrl: string }; const url = new URL(authorizationUrl);
    expect(url.searchParams.get("scope")).toBe(SHEETS_SCOPE); expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256"); expect(authorizationUrl).not.toContain("openid");
    const rawState = url.searchParams.get("state")!;
    const state = db.prepare("SELECT * FROM google_sheets_states").all()[0]!;
    expect(state.state_hash).toBe(await sha256Hex(rawState)); expect(state.verifier_enc).not.toBe(rawState);
    const response = await call(`/callback?state=${rawState}&code=fake-code`);
    expect(response.status).toBe(302); expect(response.headers.get("location")).toBe("/dashboard/leads?tagId=tag&sheets=connected");
    const connection = db.prepare("SELECT * FROM google_sheets_connections").all()[0]!;
    expect(connection.access_enc).not.toContain("fake-access"); expect(connection.refresh_enc).not.toContain("fake-refresh");
    expect(await decryptToken(KEY, String(connection.access_enc))).toBe("fake-access");
    const status = await (await call("/status")).json(); expect(status).toMatchObject({ configured: true, connected: true, accountEmail: "export@example.test" });
    expect(JSON.stringify(status)).not.toMatch(/fake-access|fake-refresh|fake-client-secret/); expect(creates()).toHaveLength(0);
    const tokenRequest = mock.mock.calls.find(([endpoint]) => endpoint.endsWith("/token"))![1]!;
    expect(new URLSearchParams(String(tokenRequest.body)).get("code_verifier")).toBe(await decryptToken(KEY, String(state.verifier_enc)));
    const count = mock.mock.calls.length; await call(`/callback?state=${rawState}&code=replay`); expect(mock.mock.calls).toHaveLength(count);
  });

  it("다른 사용자·세션과 만료된 state는 교환하지 않고 잘못된 CSRF/Origin은 차단한다", async () => {
    const { db, call } = await setup(); const { mock } = provider();
    expect((await call("/connect", {}, 1, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await call("/connect", {}, 1, { "X-CSRF-Token": "wrong" })).status).toBe(403);
    const { authorizationUrl } = await (await call("/connect", {})).json() as { authorizationUrl: string };
    const state = new URL(authorizationUrl).searchParams.get("state")!;
    await call(`/callback?state=${state}&code=stolen`, undefined, 2); expect(mock).not.toHaveBeenCalled();
    db.exec("UPDATE google_sheets_states SET session_id=(SELECT id FROM sessions WHERE user_id='u2')");
    await call(`/callback?state=${state}&code=wrong-session`); expect(mock).not.toHaveBeenCalled();
    db.exec("UPDATE google_sheets_states SET session_id=(SELECT id FROM sessions WHERE user_id='u1'),expires_at=1");
    await call(`/callback?state=${state}&code=expired`); expect(mock).not.toHaveBeenCalled();
  });

  it("취소·scope거절은 기존 연결을 바꾸지 않고 연결 해제 후 늦은 콜백도 복원하지 않는다", async () => {
    const { db, call, seedConnection } = await setup(); await seedConnection(); const { mock } = provider();
    const connect = async () => new URL((await (await call("/connect", {})).json() as { authorizationUrl: string }).authorizationUrl).searchParams.get("state")!;
    const cancelled = await call(`/callback?state=${await connect()}&error=access_denied`); expect(cancelled.headers.get("location")).toContain("sheets=cancelled"); expect(mock).not.toHaveBeenCalled();
    mock.mockResolvedValueOnce(Response.json({ access_token: "wrong-scope", token_type: "Bearer", expires_in: 3600, scope: "https://www.googleapis.com/auth/drive" }));
    expect((await call(`/callback?state=${await connect()}&code=scope`)).headers.get("location")).toContain("sheets=failed");
    expect(await decryptToken(KEY, String(db.prepare("SELECT access_enc FROM google_sheets_connections").all()[0]?.access_enc))).toBe("fake-access");
    const late = await connect(); await call("/disconnect", {}); const before = mock.mock.calls.length;
    await call(`/callback?state=${late}&code=late`); expect(mock.mock.calls).toHaveLength(before);
    expect(db.prepare("SELECT access_enc,refresh_enc FROM google_sheets_connections").all()[0]).toEqual({ access_enc: null, refresh_enc: null });
    expect(mock.mock.calls.some(([endpoint]) => endpoint.includes("revoke"))).toBe(false);
  });

  it("세션이 교환 중 종료되면 계정 조회·토큰 저장으로 진행하지 않는다", async () => {
    const { db, call } = await setup(); const { mock } = provider();
    const url = new URL((await (await call("/connect", {})).json() as { authorizationUrl: string }).authorizationUrl);
    mock.mockImplementationOnce(async () => { db.exec("DELETE FROM sessions WHERE user_id='u1'"); return Response.json({ access_token: "late-access", token_type: "Bearer", expires_in: 3600, scope: SHEETS_SCOPE }); });
    expect((await call(`/callback?state=${url.searchParams.get("state")}&code=fake`)).headers.get("location")).toContain("sheets=failed");
    expect(mock.mock.calls).toHaveLength(1); expect(db.prepare("SELECT access_enc FROM google_sheets_connections").all()[0]?.access_enc).toBeNull();
  });
});

describe("필터와 권한을 보존한 Google Sheets 내보내기", () => {
  it("리드 CSV의 같은 행을 RAW로 쓰며 수식·전화번호 문자열과 workspace 경계를 유지한다", async () => {
    const { call, seedConnection, orm } = await setup(); await seedConnection(); const { mock, writes, creates } = provider();
    const filters = { q: "one@" }, request = { requestId: newId(), kind: "leads", filters };
    const exported = await result(await call("/exports", request)); expect(exported).toMatchObject({ status: "done", rows: 1, retryable: false });
    expect(writes[0]!.values).toEqual(parseCsv(leadsCsv(await filteredLeads(orm, "w1", filters), await lookups(orm, "w1"))));
    expect(writes[0]!.values[1]![1]).toBe("=1+1"); expect(JSON.stringify(writes)).not.toContain("foreign@example.test");
    expect(mock.mock.calls.find(([url]) => url.includes("/values/"))![0]).toContain("valueInputOption=RAW");
    expect(JSON.parse(String(creates()[0]![1]!.body))).not.toHaveProperty("permissions");
    const same = await result(await call("/exports", request)); expect(same.id).toBe(exported.id); expect(creates()).toHaveLength(1);
    expect((await call("/exports", { ...request, filters: { q: "l2" } })).status).toBe(409);
    expect((await call(`/exports/${exported.id}`, undefined, 2)).status).toBe(404);
  });

  it("성과 CSV와 같은 열·필터를 사용하고 정적 지표는 RAW 숫자로 유지한다", async () => {
    const { call, seedConnection, orm } = await setup(); await seedConnection(); const { writes } = provider();
    expect(await result(await call("/exports", { requestId: newId(), kind: "performance", filters: { guideId: "g1", format: "reel" } }))).toMatchObject({ status: "done", rows: 1 });
    const rows = await performanceRows(orm, "w1", { guideId: "g1", format: "reel" });
    expect(writes[0]!.values).toEqual(performanceCells(rows));
    expect(writes[0]!.values.map((row) => row.map(String))).toEqual(parseCsv(performanceCsv(rows)));
    expect(writes[0]!.values[1]).toContain(123); expect(JSON.stringify(writes)).not.toContain("TEST2");
  });

  it("다른 워크스페이스의 그룹/가이드 필터나 미인증 요청은 외부 파일을 만들지 않는다", async () => {
    const { db, call, seedConnection } = await setup(); await seedConnection(); const { mock } = provider();
    db.exec("INSERT INTO lead_groups (id,workspace_id,name,rules,created_at) VALUES ('foreign-group','w2','다른 그룹','{\"all\":[]}',1)");
    for (const filters of [{ groupId: "foreign-group" }, { guideId: "g2" }]) expect((await call("/exports", { requestId: newId(), kind: "leads", filters })).status).toBe(404);
    expect((await call("/exports", { requestId: newId(), kind: "leads" }, 1, { cookie: "" })).status).toBe(401); expect(mock).not.toHaveBeenCalled();
  });

  it.each(["before_request", "before_insert"])("확인한 Google 계정 A에서 B로 바뀌면stale내보내기를예약하거나전송하지않는다(%s)", async (when) => {
    const { db, d1, env, call, seedConnection } = await setup(); await seedConnection(); const { mock } = provider();
    const status = await (await call("/status")).json() as { generation: string };
    expect(status.generation).toBe("generation");
    if (when === "before_request") db.exec("UPDATE google_sheets_connections SET generation='account-B',account_email='other@example.test'");
    else env.DB = { ...d1, prepare: (query: string) => {
      if (query.includes("INSERT INTO google_sheets_exports")) db.exec("UPDATE google_sheets_connections SET generation='account-B',account_email='other@example.test'");
      return d1.prepare(query);
    } } as D1Database;
    const response = await call("/exports", { requestId: newId(), connectionGeneration: status.generation, kind: "leads", filters: {} });
    expect(response.status).toBe(409); expect(mock).not.toHaveBeenCalled(); expect(db.prepare("SELECT * FROM google_sheets_exports").all()).toHaveLength(0);
  });

  it("생성 응답을 잃으면 unknown으로 남기고 같은 요청을 반복해도 새 파일을 만들지 않는다", async () => {
    const { call, seedConnection, db } = await setup(); await seedConnection(); const { mock, creates } = provider();
    mock.mockImplementationOnce(async () => { throw new TypeError("network lost"); });
    const request = { requestId: newId(), kind: "leads", filters: {} };
    const first = await result(await call("/exports", request)); expect(first).toMatchObject({ status: "unknown", retryable: false, errorCode: "create_unknown" });
    expect(db.prepare("SELECT payload_enc FROM google_sheets_exports").all()[0]?.payload_enc).not.toContain("one@example.test");
    expect((await result(await call("/exports", request))).status).toBe("unknown"); expect(creates()).toHaveLength(1);
  });

  it("알려진 파일의 쓰기 실패만 같은 ID로 재시도해 추가 파일 없이 완료한다", async () => {
    const { db, call, seedConnection } = await setup(); await seedConnection(); const { mock, creates, writes } = provider();
    const original = mock.getMockImplementation()!;
    let fail = true;
    mock.mockImplementation(async (url, init) => { if (url.includes("/values/") && fail) { fail = false; return new Response("provider error", { status: 503 }); } return original(url, init); });
    const request = { requestId: newId(), kind: "leads", filters: {} };
    expect(await result(await call("/exports", request))).toMatchObject({ status: "failed", retryable: true, errorCode: "write_failed" });
    db.exec("UPDATE leads SET name='changed-after-request' WHERE id='l1'");
    expect(await result(await call("/exports", request))).toMatchObject({ status: "done" }); expect(creates()).toHaveLength(1); expect(writes).toHaveLength(1);
    expect(JSON.stringify(writes[0]!.values)).toContain("=1+1"); expect(JSON.stringify(writes[0]!.values)).not.toContain("changed-after-request");
  });

  it("동시에 같은 내보내기를 눌러도 생성은 한 번만 하고 진행 중인 요청을 공유한다", async () => {
    const { call, seedConnection } = await setup(); await seedConnection(); const { mock, creates } = provider();
    let release!: (response: Response) => void, signal!: () => void;
    const started = new Promise<void>((resolve) => { signal = resolve; });
    mock.mockImplementationOnce(async () => { signal(); return new Promise<Response>((resolve) => { release = resolve; }); });
    const request = { requestId: newId(), kind: "leads", filters: {} };
    const first = call("/exports", request); await started;
    const second = await result(await call("/exports", request)); expect(second.status).toBe("creating"); expect(creates()).toHaveLength(1);
    release(Response.json({ spreadsheetId: "only-one-sheet" }));
    const complete = await result(await first); expect(complete.id).toBe(second.id); expect(complete.status).toBe("done"); expect(creates()).toHaveLength(1);
  });

  it("만료 토큰을 갱신하고 invalid_grant면 연결을 지우며 늦은 refresh가 재연결을 덮지 않는다", async () => {
    const { db, env, orm, seedConnection } = await setup(); await seedConnection(NOW - 1); const { mock } = provider();
    expect(await sheetsAccessToken(env, orm, "u1", "generation")).toBe("fake-access"); expect(new URLSearchParams(String(mock.mock.calls[0]![1]!.body)).get("grant_type")).toBe("refresh_token");
    db.exec("UPDATE google_sheets_connections SET expires_at=1");
    mock.mockImplementationOnce(async () => { db.exec("UPDATE google_sheets_connections SET generation='new-generation'"); return Response.json({ access_token: "late-access", token_type: "Bearer", expires_in: 3600 }); });
    await expect(sheetsAccessToken(env, orm, "u1", "generation")).rejects.toMatchObject({ code: "connection_changed" });
    expect(await decryptToken(KEY, String(db.prepare("SELECT access_enc FROM google_sheets_connections").all()[0]?.access_enc))).toBe("fake-access");
    mock.mockResolvedValueOnce(new Response("invalid_grant", { status: 400 }));
    await expect(sheetsAccessToken(env, orm, "u1", "new-generation")).rejects.toMatchObject({ code: "reconnect_required" }); expect(db.prepare("SELECT access_enc FROM google_sheets_connections").all()[0]?.access_enc).toBeNull();
  });

  it("생성 중 연결 해제되면 파일 ID만 보존하고 리드 본문을 전송하지 않는다", async () => {
    const { call, seedConnection } = await setup(); await seedConnection(); const { mock, writes } = provider();
    mock.mockImplementationOnce(async () => { await call("/disconnect", {}); return Response.json({ spreadsheetId: "empty-sheet" }); });
    const exported = await result(await call("/exports", { requestId: newId(), kind: "leads", filters: {} }));
    expect(exported).toMatchObject({ status: "cancelled", retryable: false }); expect(exported.spreadsheetUrl).toContain("empty-sheet"); expect(writes).toHaveLength(0);
  });

  it("파일 생성 중 멤버 권한이 없어지면 쓰기 전에 다시 확인해 본문을 보내지 않는다", async () => {
    const { db, call, seedConnection } = await setup(); await seedConnection(); const { mock, writes } = provider();
    mock.mockImplementationOnce(async () => { db.exec("DELETE FROM members WHERE user_id='u1'"); return Response.json({ spreadsheetId: "empty-sheet" }); });
    const exported = await result(await call("/exports", { requestId: newId(), kind: "leads", filters: {} }));
    expect(exported).toMatchObject({ status: "failed", errorCode: "connection_changed", retryable: false }); expect(writes).toHaveLength(0);
  });

  it.each(["generation", "membership", "session"])("마지막 확인 뒤 writing UPDATE 직전 %s가 바뀌어도 원자 조건으로 PUT을 막는다", async (change) => {
    const { db, d1, env, call, seedConnection } = await setup(); await seedConnection(); const { writes } = provider();
    let injected = false;
    env.DB = { ...d1, prepare: (query: string) => {
      if (!injected && query.includes("SET status='writing'")) {
        injected = true;
        if (change === "generation") db.exec("UPDATE google_sheets_connections SET generation='replacement'");
        if (change === "membership") db.exec("DELETE FROM members WHERE user_id='u1'");
        if (change === "session") db.exec("DELETE FROM sessions WHERE user_id='u1'");
      }
      return d1.prepare(query);
    } } as D1Database;
    const exported = await result(await call("/exports", { requestId: newId(), kind: "leads", filters: {} }));
    expect(injected).toBe(true); expect(writes).toHaveLength(0);
    expect(exported).toMatchObject({ status: "failed", errorCode: "connection_changed", retryable: false });
    expect(exported.spreadsheetUrl).toContain("test-sheet");
  });

  it("이미 시작된 PUT 중 권한을 잃으면 파일은 보존하고 done으로 표시하지 않는다", async () => {
    const { db, call, seedConnection } = await setup(); await seedConnection(); const { mock } = provider(); const original = mock.getMockImplementation()!;
    mock.mockImplementation(async (url, init) => { const response = await original(url, init); if (url.includes("/values/")) db.exec("DELETE FROM members WHERE user_id='u1'"); return response; });
    expect(await result(await call("/exports", { requestId: newId(), kind: "leads", filters: {} }))).toMatchObject({ status: "failed", errorCode: "connection_changed", retryable: false });
  });

  it("PUT 중 자연 만료된 세션도 완료 시점의 새 시각으로 검사한다", async () => {
    const { call, seedConnection } = await setup(); await seedConnection(); const { mock } = provider(); const original = mock.getMockImplementation()!;
    mock.mockImplementation(async (url, init) => { const response = await original(url, init); if (url.includes("/values/")) vi.spyOn(Date, "now").mockReturnValue(NOW + 3600_000 + 1); return response; });
    expect(await result(await call("/exports", { requestId: newId(), kind: "leads", filters: {} }))).toMatchObject({ status: "failed", errorCode: "connection_changed", retryable: false });
  });

  it.each([false, true])("동시 refresh 패자는 같은 세대의 검증된 승자 토큰을 쓰고 회전된 연결은 덮지 않는다(실패=%s)", async (loserFails) => {
    const { env, orm, seedConnection } = await setup(); await seedConnection(NOW - 1); const { mock } = provider();
    let release!: (response: Response) => void, signal!: () => void;
    const started = new Promise<void>((resolve) => { signal = resolve; });
    mock.mockImplementationOnce(async () => { signal(); return new Promise<Response>((resolve) => { release = resolve; }); });
    const first = sheetsAccessToken(env, orm, "u1", "generation"); await started;
    const second = await sheetsAccessToken(env, orm, "u1", "generation");
    release(loserFails ? new Response("invalid_grant", { status: 400 }) : Response.json({ access_token: "late-loser-token", token_type: "Bearer", expires_in: 3600, scope: SHEETS_SCOPE }));
    expect(await first).toBe(second); expect(second).toBe("fake-access");
  });

  it("멈춘 creating은 unknown,ID가있는writing은안전retry로닫고cleanup은토큰이나자료를노출하지않는다", async () => {
    const { db, env, call, seedConnection } = await setup(); await seedConnection(); const { mock, creates } = provider();
    mock.mockImplementationOnce(async () => { throw new Error("lost"); });
    const exported = await result(await call("/exports", { requestId: newId(), kind: "leads", filters: {} }));
    db.prepare("UPDATE google_sheets_exports SET status='creating',updated_at=? WHERE id=?").run(NOW - 16 * 60_000, exported.id);
    expect(await result(await call(`/exports/${exported.id}`))).toMatchObject({ status: "unknown", retryable: false });
    db.prepare("UPDATE google_sheets_exports SET status='writing',spreadsheet_id='known-sheet',updated_at=? WHERE id=?").run(NOW - 16 * 60_000, exported.id);
    await cleanupGoogleSheetsJobs(env);
    expect(await result(await call(`/exports/${exported.id}`))).toMatchObject({ status: "failed", retryable: true, errorCode: "write_failed" });
    expect(creates()).toHaveLength(1);
  });

  it("source bytes·1000행·512KB 상한을 외부 호출 전에 거절하고 24시간 후 payload를 파기한다", async () => {
    const { db, env, orm, call, seedConnection, lead } = await setup(); await seedConnection(); const { mock } = provider();
    for (let n = 0; n < 6; n++) { lead(`big${n}`); db.prepare("UPDATE leads SET answers=? WHERE id=?").run(JSON.stringify({ padding: "x".repeat(1_500_000) }), `big${n}`); }
    const source = await call("/exports", { requestId: newId(), kind: "leads", filters: {} }); expect(source.status).toBe(413); expect(mock).not.toHaveBeenCalled();
    db.exec("DELETE FROM leads WHERE id LIKE 'big%'");
    for (let n = 0; n < 999; n++) lead(`count${n}`);
    await expect(sheetsExportValues(orm, "w1", "leads", {})).rejects.toMatchObject({ code: "export_too_many_rows" });
    db.exec("DELETE FROM leads WHERE id LIKE 'count%'");
    db.prepare("UPDATE leads SET name=? WHERE id='l1'").run("x".repeat(50_001));
    await expect(sheetsExportValues(orm, "w1", "leads", {})).rejects.toMatchObject({ code: "export_payload_too_large" });
    db.exec("UPDATE leads SET name='safe' WHERE id='l1'"); mock.mockImplementationOnce(async () => { throw new Error("lost create"); });
    for (let n = 0; n < 12; n++) lead(`payload${n}`, "w1", `payload${n}@example.test`, "x".repeat(45_000));
    await expect(sheetsExportValues(orm, "w1", "leads", {})).rejects.toMatchObject({ code: "export_payload_too_large" });
    db.exec("DELETE FROM leads WHERE id LIKE 'payload%'");
    await call("/exports", { requestId: newId(), kind: "leads", filters: {} });
    vi.spyOn(Date, "now").mockReturnValue(NOW + 24 * 3600_000 + 1); await cleanupGoogleSheetsJobs(env);
    expect(db.prepare("SELECT payload_enc FROM google_sheets_exports").all()[0]?.payload_enc).toBeNull();
  });

  it("원본 JSON이 큰 lookup·그룹도 행을 읽기 전에 거절한다", async () => {
    const { db, orm } = await setup();
    db.prepare("INSERT INTO lead_groups (id,workspace_id,name,rules,created_at) VALUES ('large-group','w1','그룹',?,1)").run(JSON.stringify({ all: [], padding: "x".repeat(130 * 1024) }));
    await expect(sheetsExportValues(orm, "w1", "leads", { groupId: "large-group" })).rejects.toMatchObject({ code: "export_source_too_large" });
    for (let n = 0; n < 6; n++) db.prepare("INSERT INTO lead_tags (id,workspace_id,name) VALUES (?,'w1',?)").run(`huge-tag-${n}`, `tag-${n}-${"x".repeat(1_500_000)}`);
    await expect(sheetsExportValues(orm, "w1", "leads", {})).rejects.toMatchObject({ code: "export_source_too_large" });
  });

  it("1,000개 성과 행의 실제 CSV 조회·세션·쓰기까지 D1과외부HTTP합이50회이하다", async () => {
    const { db, d1, env, call, seedConnection } = await setup(); await seedConnection(NOW - 1); const { mock, writes } = provider();
    for (let n = 0; n < 999; n++) {
      db.prepare("INSERT INTO influencers (id,workspace_id,display_name,created_at) VALUES (?,'w1','테스트',1)").run(`bulk-i-${n}`);
      db.prepare("INSERT INTO guide_influencers (id,guide_id,influencer_id,guide_token,upload_token,feedback_token,connect_token,token_expires_at,created_at) VALUES (?,'g1',?,?,?,?,?,?,1)")
        .run(`bulk-gi-${n}`, `bulk-i-${n}`, `bulk-g-${n}`, `bulk-u-${n}`, `bulk-f-${n}`, `bulk-c-${n}`, NOW + 3600_000);
      db.prepare("INSERT INTO contents (id,guide_id,influencer_id,guide_influencer_id,url,format,url_submitted_by,registered_at) VALUES (?,'g1',?,?,?,'reel','brand',1)").run(`bulk-content-${n}`, `bulk-i-${n}`, `bulk-gi-${n}`, `https://www.instagram.com/reel/TESTBULK${n}/`);
    }
    let calls = 0, batching = false;
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, { get(target, key) {
      if (key === "bind") return (...params: unknown[]) => wrap(target.bind(...params));
      if (["run", "all", "raw", "first"].includes(String(key))) return (...params: unknown[]) => { if (!batching) calls++; return Reflect.get(target, key).apply(target, params); };
      return Reflect.get(target, key);
    } });
    env.DB = { ...d1, prepare: (query: string) => wrap(d1.prepare(query)), batch: async (statements: D1PreparedStatement[]) => { calls++; batching = true; try { return await d1.batch(statements); } finally { batching = false; } } } as D1Database;
    expect(await result(await call("/exports", { requestId: newId(), kind: "performance", filters: {} }))).toMatchObject({ status: "done", rows: 1000 });
    expect(writes[0]!.values).toHaveLength(1001); expect(mock).toHaveBeenCalledTimes(3);
    expect(calls + mock.mock.calls.length).toBeLessThanOrEqual(50); expect(calls).toBeGreaterThan(20);
  });
});
