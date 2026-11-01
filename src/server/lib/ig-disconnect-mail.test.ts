import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { igConnections } from "../db/schema";
import { createSqliteD1, countD1Calls, type TestSqlite } from "../test/sqlite-d1";
import { encryptToken, decryptToken } from "./crypto";
import { classifyIgFailure } from "./instagram";
import { definitiveIgDisconnect, igConnectionState, igConnectionUsableSql, igGrantVerified } from "./ig-connection-state";
import { disconnectIgConnection, enqueueIgConnectionMaintenance, processIgConnectionCheck, processIgConnectionMaintenance, processIgDisconnectMail } from "./ig-disconnect-mail";
import { processSnapshotCollection } from "./snapshots";
import { retryQueuedDms } from "./keyword-dm";
import { performanceRows } from "../routes/performance";
import { stageSummaries, workspaceCounts } from "./guide-status";
import worker from "../index";
import type { PipelineMessage } from "../jobs";
import { Hono } from "hono";
import type { AppEnv, Auth } from "../types";
import { createKeywordDmRoutes } from "../routes/keyword-dm";
import { ApiError, errorBody } from "./errors";

const NOW = Date.parse("2026-11-01T10:00:00Z"), KEY = "lifecycle-test-encryption-key";
const closes: (() => void)[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { for (const close of closes.splice(0)) close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup(configured = true) {
  const base = await createSqliteD1(); closes.push(base.close);
  const { db } = base, counted = countD1Calls(base.d1), orm = getDb(counted.d1);
  db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w','test brand',1),('other','other',1)");
  for (const [id, role, workspace] of [["owner", "owner", "w"], ["editor", "editor", "w"], ["viewer", "viewer", "w"], ["foreign", "owner", "other"]]) {
    db.prepare("INSERT INTO users(id,email,password_hash,name,created_at) VALUES(?,?,'','test',1)").run(id!, `${id}@example.test`);
    db.prepare("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES(?,?,?,1)").run(workspace!, id!, role!);
  }
  db.exec("INSERT INTO brands(id,workspace_id,name,created_at) VALUES('brand','w','brand',1)");
  db.exec("INSERT INTO campaigns(id,workspace_id,brand_id,name,status,created_at,updated_at) VALUES('campaign','w','brand','campaign','active',1,1)");
  db.exec("INSERT INTO guides(id,workspace_id,campaign_id,name,slug,status,extra_rules,product,deliverables,secondary_use_scope,created_at,updated_at) VALUES('guide','w','campaign','guide','guide-slug','published','[]','{}','{}','{}',1,1)");
  db.exec("INSERT INTO influencers(id,workspace_id,display_name,email,lang,created_at) VALUES('creator','w','creator','creator@example.test','ko',1)");
  db.prepare("INSERT INTO guide_influencers(id,guide_id,influencer_id,guide_token,upload_token,feedback_token,connect_token,token_expires_at,created_at) VALUES('gi','guide','creator','guide-token-long','upload-token-long','feedback-token-long','connect-token-long',?,1)").run(NOW + 86_400_000);
  db.prepare("INSERT INTO ig_connections(id,workspace_id,influencer_id,target,ig_user_id,account_type,scopes,token_enc,expires_at,connected_at,generation,grants_verified_at,created_at) VALUES('connection','w','creator','influencer','123456789','BUSINESS','[\"instagram_business_basic\",\"instagram_business_manage_insights\"]',?, ?,?,'generation-A',?,1)")
    .run(await encryptToken(KEY, "private-provider-token"), NOW + 3600_000, NOW - 3600_000, NOW);
  const messages: PipelineMessage[] = [];
  const sendBatch = vi.fn(async (batch: { body: PipelineMessage }[]) => { messages.push(...batch.map((message) => message.body)); });
  const env = { DB: counted.d1, TOKEN_ENC_KEY: KEY, APP_URL: "https://app.example.test", APP_ENV: "production", PIPELINE: { sendBatch },
    ...(configured ? { RESEND_API_KEY: "fake-resend-key", EMAIL_FROM: "alerts@example.test" } : { RESEND_API_KEY: "fake-resend-key" }) } as unknown as Env;
  const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: "provider-message" })); vi.stubGlobal("fetch", fetch);
  const connection = async () => (await orm.select().from(igConnections).where(eq(igConnections.id, "connection")).get())!;
  const transition = async () => disconnectIgConnection(env, orm, await connection(), "provider_auth_invalid");
  return { db, orm, counted, env, messages, sendBatch, fetch, connection, transition };
}
const rows = (db: TestSqlite) => db.prepare("SELECT * FROM ig_disconnect_mail_outbox ORDER BY recipient_kind,recipient_id").all();
const mailId = (db: TestSqlite, recipient = "owner") => String(db.prepare("SELECT id FROM ig_disconnect_mail_outbox WHERE recipient_id=?").all(recipient)[0]!.id);

function pauseOnce(base: D1Database, needle: string) {
  let resume!: () => void, started!: () => void, paused = false;
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  const waiting = new Promise<void>((resolve) => { started = resolve; });
  const d1 = { ...base, prepare(query: string) {
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, { get(target, key) {
      if (key === "bind") return (...params: unknown[]) => wrap(target.bind(...params));
      if (["all", "raw", "run", "first"].includes(String(key))) return async (...params: unknown[]) => {
        if (!paused && query.includes(needle)) { paused = true; started(); await gate; }
        return Reflect.get(target, key).apply(target, params);
      };
      return Reflect.get(target, key);
    } });
    return wrap(base.prepare(query));
  } } as D1Database;
  return { d1, waiting, resume: () => resume() };
}

describe("검증된 Instagram 연결 상태", () => {
  it("실제 grant/professional 검증과 만료 경계를 모든 상태에 공통 적용한다", async () => {
    const { connection } = await setup(); const original = await connection();
    expect(igConnectionState(original).connected).toBe(true);
    expect(igConnectionState({ ...original, expiresAt: NOW })).toMatchObject({ connected: false, expired: true, reason: "expired" });
    expect(igConnectionState({ ...original, tokenEnc: null }).reason).toBe("token_missing");
    expect(igConnectionState({ ...original, grantsVerifiedAt: null }).reason).toBe("grant_unverified");
    expect(igGrantVerified({ ...original, grantsVerifiedAt: null })).toBe(false);
    expect(igConnectionState({ ...original, scopes: [] }).reason).toBe("permissions_missing");
    expect(igConnectionState({ ...original, accountType: "PERSONAL" }).reason).toBe("not_professional");
  });

  it("190 비일시 인증 실패만 확정하고 permission/일시/rate/누락 지표로는 해제하지 않는다", () => {
    expect(definitiveIgDisconnect(classifyIgFailure(400, { error: { code: 190 } }))).toBe("provider_auth_invalid");
    for (const [status, error] of [[429, { code: 190 }], [503, { code: 190 }], [400, { code: 190, is_transient: true }], [400, { code: 10 }], [400, { code: 200 }], [400, { code: 100, error_subcode: 33 }]] as const)
      expect(definitiveIgDisconnect(classifyIgFailure(status, { error }))).toBeNull();
  });

  it("DB usable 판정도 NULL/객체/혼합 배열 scope를 거절하고 JS 판정과 일치한다", async () => {
    const { db, orm, connection } = await setup();
    const required = ["instagram_business_basic", "instagram_business_manage_insights"];
    for (const [index, scopes] of [required, [null], [...required, null], { a: required[0], b: required[1] }, []].entries()) {
      db.prepare("UPDATE ig_connections SET scopes=?,generation=? WHERE id='connection'").run(JSON.stringify(scopes), `malformed-case-${index}`);
      const expected = Array.isArray(scopes) && scopes.length === 2;
      expect(igGrantVerified(await connection())).toBe(expected);
      expect((await orm.all(sql`SELECT c.id FROM ig_connections c WHERE c.id='connection' AND ${igConnectionUsableSql("c")}`)).length > 0).toBe(expected);
    }
  });

  it("원자 전환은 generation을 회전하고 owner/editor/같은 creator에게만 수신자 원장을 한 번 만든다", async () => {
    const { db, connection, transition, env, orm } = await setup(); const snapshot = await connection();
    const result = await transition(); expect(result.changed).toBe(true); expect(result.generation).not.toBe(snapshot.generation);
    expect(await connection()).toMatchObject({ generation: result.generation, tokenEnc: null, disconnectedAt: NOW, disconnectedReason: "provider_auth_invalid" });
    expect(rows(db).map((row) => row.recipient_id)).toEqual(["editor", "owner", "creator"]);
    expect(rows(db).every((row) => row.connection_generation === result.generation)).toBe(true);
    expect(await disconnectIgConnection(env, orm, snapshot, "provider_auth_invalid")).toEqual({ changed: false, generation: null });
    expect(rows(db)).toHaveLength(3);
  });

  it("outbox 쓰기 실패는 token/generation 전환까지 롤백하고 옛 실패는 새 연결을 덮지 않는다", async () => {
    const { db, env, orm, connection, transition } = await setup(); const snapshot = await connection();
    db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON ig_disconnect_mail_outbox BEGIN SELECT RAISE(ABORT,'test'); END");
    await expect(transition()).rejects.toThrow(); expect((await connection()).generation).toBe(snapshot.generation); expect((await connection()).tokenEnc).toBe(snapshot.tokenEnc);
    db.exec("DROP TRIGGER fail_outbox");
    db.prepare("UPDATE ig_connections SET generation='generation-new',token_enc=?,connected_at=?").run(await encryptToken(KEY, "new-token"), NOW + 1);
    expect(await disconnectIgConnection(env, orm, snapshot, "provider_auth_invalid")).toEqual({ changed: false, generation: null });
    expect(rows(db)).toHaveLength(0); expect((await connection()).generation).toBe("generation-new");
  });

  it("legacy 요청 scope는 만료돼도 자동 해제/메일 대상이 되지 않는다", async () => {
    const { db, env, connection, transition, messages } = await setup();
    db.exec("UPDATE ig_connections SET grants_verified_at=NULL,generation='legacy',expires_at=1");
    expect(await transition()).toEqual({ changed: false, generation: null });
    await processIgConnectionMaintenance({}, env);
    expect(rows(db)).toHaveLength(0); expect(messages).toHaveLength(0); expect(igConnectionState(await connection()).reason).toBe("grant_unverified");
  });
});

describe("수신자별 영속 재연결 메일", () => {
  it("발신 설정이 없으면 blocked 증거만 남기고 firstAttempt/payload/예제주소 HTTP를 만들지 않는다", async () => {
    const { db, env, transition, fetch } = await setup(false); await transition();
    expect(rows(db).every((row) => row.status === "blocked" && row.first_attempt_at === null && row.payload_enc === null)).toBe(true);
    await processIgDisconnectMail({ id: mailId(db) }, env);
    expect(fetch).not.toHaveBeenCalled(); expect(rows(db).every((row) => row.first_attempt_at === null && row.payload_enc === null)).toBe(true);
  });

  it("같은 body+idempotency key로 재시도하고 성공 시 payload를 즉시 파기한다", async () => {
    const { db, env, transition, fetch } = await setup(); await transition(); const id = mailId(db);
    let deliveryCount = 0; const accepted = new Set<string>();
    fetch.mockImplementation(async (_url, init?: RequestInit) => {
      const key = new Headers(init?.headers).get("Idempotency-Key")!;
      if (!accepted.has(key)) { accepted.add(key); deliveryCount++; throw new TypeError("accepted then response lost"); }
      return Response.json({ id: "provider-message" });
    });
    await expect(processIgDisconnectMail({ id }, env)).rejects.toThrow("ig_mail_delivery_failed");
    const pending = rows(db).find((row) => row.id === id)!;
    expect(pending).toMatchObject({ status: "failed", first_attempt_at: NOW, attempts: 1 }); expect(String(pending.payload_enc)).not.toContain("owner@example.test");
    const frozen = JSON.parse(await decryptToken(KEY, String(pending.payload_enc)));
    expect(frozen.to).toBe("owner@example.test");
    await processIgDisconnectMail({ id }, env); expect(fetch).toHaveBeenCalledTimes(1); // 아직 backoff 중
    vi.spyOn(Date, "now").mockReturnValue(NOW + 15 * 60_000);
    await processIgDisconnectMail({ id }, env);
    const attempts = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(attempts[0]![1].body).toBe(attempts[1]![1].body);
    expect(new Headers(attempts[0]![1].headers).get("Idempotency-Key")).toBe(`ig-disconnect/${id}`);
    expect(new Headers(attempts[1]![1].headers).get("Idempotency-Key")).toBe(`ig-disconnect/${id}`);
    expect(deliveryCount).toBe(1);
    expect(rows(db).find((row) => row.id === id)).toMatchObject({ status: "sent", payload_enc: null, provider_id: "provider-message" });
  });

  it("24시간이 지난 모호한 전송은 unknown/manual로 닫고 ciphertext도 지워 더 보내지 않는다", async () => {
    const { db, env, transition, fetch } = await setup(); await transition(); const id = mailId(db);
    fetch.mockRejectedValueOnce(new Error("lost")); await expect(processIgDisconnectMail({ id }, env)).rejects.toThrow();
    vi.spyOn(Date, "now").mockReturnValue(NOW + 24 * 3600_000 + 1);
    await processIgDisconnectMail({ id }, env);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rows(db).find((row) => row.id === id)).toMatchObject({ status: "unknown", payload_enc: null, error_code: "delivery_window_expired" });
  });

  it.each(["workspace", "connection", "influencer", "role", "reconnect"])("%s가 사라지거나 바뀌면 대기 알림을 전송하지 않는다", async (change) => {
    const { db, env, transition, fetch } = await setup(); await transition(); const id = mailId(db, change === "influencer" ? "creator" : "owner");
    if (change === "workspace") db.exec("DELETE FROM workspaces WHERE id='w'");
    else if (change === "connection") db.exec("DELETE FROM ig_connections");
    else if (change === "influencer") db.exec("DELETE FROM influencers WHERE id='creator'");
    else if (change === "role") db.exec("UPDATE members SET role='viewer' WHERE user_id='owner'");
    else db.exec("UPDATE ig_connections SET generation='reconnected',disconnected_at=NULL,disconnected_reason=NULL");
    await processIgDisconnectMail({ id }, env);
    expect(fetch).not.toHaveBeenCalled(); expect(rows(db).find((row) => row.id === id)).toMatchObject({ status: "cancelled", payload_enc: null });
  });

  it("인플루언서 메일은 같은 workspace의 살아 있는 가이드 연결 링크만 포함한다", async () => {
    const { db, env, transition, fetch } = await setup(); await transition();
    await processIgDisconnectMail({ id: mailId(db, "creator") }, env);
    const request = (fetch.mock.calls as unknown as [string, RequestInit][])[0]![1];
    const body = JSON.parse(String(request.body)); expect(body.to).toEqual(["creator@example.test"]);
    expect(body.text).toContain("/connect/connect-token-long?lang=ko&returnMode=guide"); expect(body.text).not.toContain("foreign@example.test");
  });

  it("HTTP 직전 role 변경도 SQL fence가 차단하고 동시에 같은 메시지는 한 번만 전송한다", async () => {
    const { db, env, transition, fetch, counted } = await setup(); await transition(); const id = mailId(db);
    const original = env.DB.prepare.bind(env.DB); let injected = false;
    env.DB = { ...env.DB, prepare: (query: string) => {
      if (!injected && query.includes("SET status='sending'")) { injected = true; db.exec("UPDATE members SET role='viewer' WHERE user_id='owner'"); }
      return original(query);
    } } as D1Database;
    counted.reset(); await processIgDisconnectMail({ id }, env); expect(fetch).not.toHaveBeenCalled();
    db.exec("UPDATE members SET role='owner' WHERE user_id='owner'");
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    fetch.mockImplementationOnce(async () => { await gate; return Response.json({ id: "one" }); });
    const first = processIgDisconnectMail({ id }, env); await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await processIgDisconnectMail({ id }, env); expect(fetch).toHaveBeenCalledTimes(1); release(); await first;
  });
});

describe("기존 Queue와 제한된 유지보수", () => {
  it("Cron은 추가 D1 없이 유지보수만 넣고, perconnection/recipient는 별도 Queue에서 수행한다", async () => {
    const { db, env, counted, messages } = await setup(false); db.prepare("UPDATE ig_connections SET expires_at=?").run(NOW);
    counted.reset(); await enqueueIgConnectionMaintenance(env); expect(counted.getCalls()).toBe(0);
    expect(messages).toEqual([{ type: "ig_connection_maintenance", payload: {} }]); messages.length = 0;
    counted.reset(); await processIgConnectionMaintenance({}, env); expect(counted.getCalls()).toBeLessThan(5);
    expect(messages).toContainEqual({ type: "check_ig_connection", payload: { id: "connection", generation: "generation-A" } });
    const check = messages.find((message) => message.type === "check_ig_connection")!;
    const ack = vi.fn(), retry = vi.fn(); counted.reset();
    await worker.queue({ queue: "avocado-pipeline", messages: [{ body: check, ack, retry }] } as unknown as MessageBatch<PipelineMessage>, env);
    expect(ack).toHaveBeenCalledTimes(1); expect(retry).not.toHaveBeenCalled(); expect(counted.getCalls()).toBeLessThan(8);
    expect(rows(db)).toHaveLength(3);
  });

  it("메일 한 수신자는 middleware 없는 Queue에서 D1/HTTP 예산을 지키고 실패는 retry한다", async () => {
    const { db, env, counted, fetch, transition } = await setup(); await transition(); const id = mailId(db, "creator");
    const ack = vi.fn(), retry = vi.fn(); counted.reset();
    fetch.mockRejectedValueOnce(new Error("network"));
    const batch = { queue: "avocado-pipeline", messages: [{ body: { type: "ig_disconnect_mail", payload: { id } }, ack, retry }] } as unknown as MessageBatch<PipelineMessage>;
    await worker.queue(batch, env); expect(retry).toHaveBeenCalledTimes(1); expect(ack).not.toHaveBeenCalled(); expect(counted.getCalls()).toBeLessThan(15);
    vi.spyOn(Date, "now").mockReturnValue(NOW + 15 * 60_000);
    counted.reset(); await worker.queue(batch, env); expect(ack).toHaveBeenCalledTimes(1); expect(counted.getCalls()).toBeLessThan(15); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("HTTP 성공 뒤 최종 DB 실패 경로도 한 수신자 D1 8회와 HTTP 1회 안에 머문다", async () => {
    const { db, env, transition, counted, fetch } = await setup(); await transition(); const id = mailId(db, "creator");
    db.exec("CREATE TRIGGER fail_sent BEFORE UPDATE OF status ON ig_disconnect_mail_outbox WHEN NEW.status='sent' BEGIN SELECT RAISE(ABORT,'test'); END");
    counted.reset(); await expect(processIgDisconnectMail({ id }, env)).rejects.toThrow();
    expect(counted.getCalls()).toBe(8); expect(fetch).toHaveBeenCalledTimes(1);
    expect(rows(db).find((row) => row.id === id)).toMatchObject({ status: "failed", first_attempt_at: NOW });
  });

  it("OAuth 원장은 cookie 유예 뒤 1000개씩 지우고 집계 로그에는 capability/연락처를 담지 않는다", async () => {
    const { db, env, counted } = await setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (let n = 0; n < 1001; n++) db.prepare("INSERT INTO ig_oauth_states(state_hash,nonce_hash,target,workspace_id,connection_id,connection_generation,return_mode,return_path,lang,expires_at,created_at) VALUES(?,'nonce','influencer','w','connection','generation-A','guide','/g/private-capability','ko',?,1)").run(`state-${n}`, NOW - 5 * 60_000);
    db.prepare("INSERT INTO ig_oauth_states(state_hash,nonce_hash,target,workspace_id,connection_id,connection_generation,return_mode,return_path,lang,expires_at,created_at) VALUES('recent','nonce','influencer','w','connection','generation-A','guide','/g/private-capability','ko',?,1)").run(NOW - 5 * 60_000 + 1);
    counted.reset(); await processIgConnectionMaintenance({}, env);
    expect(counted.getCalls()).toBe(1);
    expect(db.prepare("SELECT state_hash FROM ig_oauth_states").all()).toHaveLength(2);
    const text = String(log.mock.calls[0]![1]);
    expect(JSON.parse(text)).toMatchObject({ oauthStatesDeleted: 1000, connectionChecksQueued: 0, recipientMailQueued: 0, failures: 0 });
    expect(text).not.toMatch(/capability|example.test|generation-A|state-/);
  });
});

describe("느린 처리자의 outbox CAS", () => {
  it.each(["block", "close"])("늦은 %s 처리자가 다른 worker의 실제 sending lease를 덮지 않는다", async (action) => {
    const { db, env, transition, fetch } = await setup(); await transition(); const id = mailId(db);
    const paused = pauseOnce(env.DB, "SELECT w.name");
    const slow = processIgDisconnectMail({ id }, { ...env, DB: paused.d1, ...(action === "block" ? { EMAIL_FROM: undefined } : {}) } as Env);
    await paused.waiting;
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    fetch.mockImplementationOnce(async () => { await gate; return Response.json({ id: "actual-delivery" }); });
    const sending = processIgDisconnectMail({ id }, env); await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const lease = rows(db).find((row) => row.id === id)!.lease_token;
    if (action === "close") db.exec("UPDATE ig_connections SET generation='reconnected',disconnected_at=NULL,disconnected_reason=NULL");
    paused.resume(); await slow;
    expect(rows(db).find((row) => row.id === id)).toMatchObject({ status: "sending", lease_token: lease });
    release(); await sending;
    expect(rows(db).find((row) => row.id === id)).toMatchObject({ status: "sent", provider_id: "actual-delivery", payload_enc: null });
  });

  it("오래된 queued snapshot이 다른 시도의 frozen body와 firstAttempt를 덮지 못한다", async () => {
    const { db, env, transition, fetch } = await setup(); await transition(); const id = mailId(db);
    const paused = pauseOnce(env.DB, "SET status='sending'");
    const slow = processIgDisconnectMail({ id }, { ...env, DB: paused.d1 }); await paused.waiting;
    db.exec("UPDATE workspaces SET name='NEW BRAND' WHERE id='w'");
    fetch.mockRejectedValueOnce(new Error("lost response"));
    await expect(processIgDisconnectMail({ id }, env)).rejects.toThrow();
    const frozen = rows(db).find((row) => row.id === id)!;
    expect(JSON.parse(await decryptToken(KEY, String(frozen.payload_enc))).text).toContain("NEW BRAND");
    paused.resume(); await slow;
    expect(rows(db).find((row) => row.id === id)).toMatchObject({ status: "failed", payload_enc: frozen.payload_enc, first_attempt_at: frozen.first_attempt_at, attempts: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, "now").mockReturnValue(NOW + 15 * 60_000); await processIgDisconnectMail({ id }, env);
    const requests = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(requests[0]![1].body).toBe(requests[1]![1].body);
  });
});

describe("수집·화면·키워드 DM의 공통 usable", () => {
  it("스냅샷의 로컬 만료 감지는 provider 없이 새 세대와 blocked outbox를 남긴다", async () => {
    const { db, env, connection, fetch } = await setup(false);
    db.prepare("UPDATE ig_connections SET expires_at=?").run(NOW);
    db.prepare("INSERT INTO contents(id,guide_id,influencer_id,guide_influencer_id,url,ig_media_id,format,url_submitted_by,registered_at) VALUES('post','guide','creator','gi','https://www.instagram.com/reel/POST/','123','reel','brand',?)").run(NOW - 86_400_000);
    db.prepare("INSERT INTO metric_snapshots(id,content_id,offset_h,scheduled_at,status,missing) VALUES('snapshot','post',24,?,'scheduled','{}')").run(NOW);
    await processSnapshotCollection({ snapshotId: "snapshot" }, env);
    expect(fetch).not.toHaveBeenCalled(); expect((await connection()).generation).not.toBe("generation-A");
    expect((await connection()).disconnectedReason).toBe("expired"); expect(rows(db)).toHaveLength(3);
    expect(rows(db).every((row) => row.status === "blocked")).toBe(true);
  });

  it("성과표·가이드 단계는 더 새로운 미검증 연결을 건너뛰어 옛 연결을 부활시키지 않는다", async () => {
    const { db, orm } = await setup();
    db.exec("INSERT INTO contents(id,guide_id,influencer_id,guide_influencer_id,url,format,url_submitted_by,registered_at) VALUES('post','guide','creator','gi','https://www.instagram.com/reel/POST/','reel','brand',1)");
    expect((await performanceRows(orm, "w", {}))[0]!.connected).toBe(true);
    expect((await stageSummaries(orm, "guide")).get("gi")!.connected).toBe(true);
    db.prepare("INSERT INTO ig_connections(id,workspace_id,influencer_id,target,account_type,scopes,expires_at,connected_at,generation,created_at) VALUES('newer','w','creator','influencer','BUSINESS','[]',?,?,'legacy-newer',2)").run(NOW + 3600_000, NOW);
    expect((await performanceRows(orm, "w", {}))[0]!.connected).toBe(false);
    expect((await stageSummaries(orm, "guide")).get("gi")!.connected).toBe(false);
  });

  it("키워드 route GET/toggle과 홈도 검증·만료 상태를 공유하고 마지막 generation 변경을 막는다", async () => {
    const { db, env, orm } = await setup();
    db.prepare("INSERT INTO ig_connections(id,workspace_id,target,ig_user_id,account_type,scopes,token_enc,expires_at,connected_at,generation,grants_verified_at,created_at) VALUES('sender','w','brand_sender','123','BUSINESS',?,'sender-token',?,?,'sender-generation',?,1)")
      .run(JSON.stringify(["instagram_business_basic", "instagram_business_manage_insights", "instagram_business_manage_comments", "instagram_business_manage_messages"]), NOW + 3600_000, NOW, NOW);
    db.exec("INSERT INTO short_links(id,workspace_id,guide_id,influencer_id,channel_key,slug,destination_type,destination_url,utm,og,created_at) VALUES('link','w','guide','creator','ig_bio','link-slug','url','https://example.test','{}','{}',1)");
    db.exec("INSERT INTO keyword_dm_rules(id,workspace_id,guide_id,influencer_id,ig_connection_id,ig_media_id,keywords,message,public_reply_variants,status,enabled,created_at,updated_at) VALUES('rule','w','guide','creator','sender','123','[\"give\"]','{link}','[]','off',0,1,1)");
    const auth: Auth = { sessionId: "session", user: { id: "owner", name: "owner", email: "owner@example.test" }, role: "owner", phone: null, phoneVerified: true, workspace: { id: "w", name: "w", plan: "starter", onboardedAt: 1 } };
    const app = new Hono<AppEnv>(); app.use("*", async (c, next) => { c.set("db", getDb(c.env.DB)); c.set("auth", auth); await next(); }); app.route("/keyword", createKeywordDmRoutes({ configured: true }));
    app.onError((error, c) => error instanceof ApiError ? c.json(errorBody(error.code, error.message), error.status) : c.text(String(error), 500));
    const configuredEnv = { ...env, META_APP_ID: "fake-app", META_APP_SECRET: "fake-secret", PUBLIC_SHORT_BASE: "https://app.example.test/l" } as Env;
    const get = () => app.request("/keyword", undefined, configuredEnv);
    const toggle = () => app.request("/keyword/rule/toggle", { method: "POST", headers: { "content-type": "application/json" }, body: '{"on":true}' }, configuredEnv);
    expect((await workspaceCounts(orm, "w")).igConnected).toBe(true);
    expect((await (await get()).json() as { connection: { connected: boolean } }).connection.connected).toBe(true);
    db.exec("UPDATE ig_connections SET generation='unverified',grants_verified_at=NULL WHERE id='sender'");
    expect((await (await get()).json() as { connection: { connected: boolean } }).connection.connected).toBe(false);
    expect((await toggle()).status).toBe(409);
    db.prepare("UPDATE ig_connections SET generation='verified',grants_verified_at=? WHERE id='sender'").run(NOW);
    const prepare = configuredEnv.DB.prepare.bind(configuredEnv.DB); let injected = false;
    configuredEnv.DB = { ...configuredEnv.DB, prepare(query: string) {
      if (!injected && query.includes('update "keyword_dm_rules"') && query.includes('"ig_connection_id"')) { injected = true; db.exec("UPDATE ig_connections SET generation='disconnected',token_enc=NULL,disconnected_at=1,disconnected_reason='manual' WHERE id='sender'"); }
      return prepare(query);
    } } as D1Database;
    expect((await toggle()).status).toBe(409);
    expect(db.prepare("SELECT enabled,status FROM keyword_dm_rules").all()[0]).toEqual({ enabled: 0, status: "off" });
  });
});
