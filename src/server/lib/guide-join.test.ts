import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../index";
import { countD1Calls, createSqliteD1, type TestSqlite } from "../test/sqlite-d1";
import { publicJoinChallenge, cleanupPublicJoinLimits, PUBLIC_JOIN_MAX_BYTES, PUBLIC_JOIN_IP_LIMIT, PUBLIC_JOIN_GUIDE_LIMIT } from "./guide-join";
import { TOKEN_TTL_MS } from "../../shared/guides";

const NOW = 1_800_000_000_000, ORIGIN = "https://app.example.test";
const databases: TestSqlite[] = [];
const profile = { displayName: "테스트 크리에이터", igHandle: "@creator", email: "creator@example.test", lang: "en", turnstileToken: "private-challenge-token" };
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { databases.splice(0).forEach((db) => db.close()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
type SendOptions = { slug?: string; ip?: string | null; headers?: Record<string, string>; path?: string; method?: string };

async function setup() {
  const { db, d1: base } = await createSqliteD1(); databases.push(db);
  db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w1','브랜드1',1),('w2','브랜드2',1)");
  for (const [id, ws, slug, status] of [["g1", "w1", "campaign-one", "published"], ["g2", "w2", "campaign-two", "published"], ["draft", "w1", "draft-guide", "draft"]]) {
    db.prepare("INSERT INTO guides(id,workspace_id,name,slug,status,extra_rules,product,deliverables,secondary_use_scope,created_at,updated_at) VALUES(?,?,?, ?,?,'[]','{}','{}','{}',1,1)").run(id!, ws!, id!, slug!, status!);
  }
  db.exec("INSERT INTO influencers(id,workspace_id,display_name,email,created_at) VALUES('existing','w1','기존 사람','creator@example.test',1)");
  db.prepare("INSERT INTO guide_influencers(id,guide_id,influencer_id,guide_token,upload_token,feedback_token,connect_token,token_expires_at,created_at) VALUES('existing-gi','g1','existing','old-private-guide','old-private-upload','old-private-feedback','old-private-connect',?,1)").run(NOW + 86_400_000);
  const counted = countD1Calls(base);
  let beforeBatch: (() => void) | undefined, beforeQuery: ((sql: string) => void) | undefined, batchChanges: number[] | undefined;
  const d1 = { ...counted.d1, prepare: (sql: string) => { beforeQuery?.(sql); return counted.d1.prepare(sql); }, batch: async (statements: D1PreparedStatement[]) => { beforeBatch?.(); const result = await counted.d1.batch(statements); batchChanges = result.map((statement) => statement.meta.changes); return result; } } as D1Database;
  const env = { DB: d1, APP_ENV: "production", APP_URL: ORIGIN, TOKEN_ENC_KEY: "fake-ip-hmac-key", TURNSTILE_SITE_KEY: "configured-site-key", TURNSTILE_SECRET_KEY: "configured-secret-key" } as Env;
  const context = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} } as unknown as ExecutionContext;
  const raw = (body: string | ReadableStream<Uint8Array>, options: SendOptions = {}) => worker.fetch(new Request(`${ORIGIN}${options.path ?? `/api/public/guide/${options.slug ?? "campaign-one"}/join`}`, {
    method: options.method ?? "POST", headers: { "Content-Type": "application/json", ...(options.ip !== null && { "CF-Connecting-IP": options.ip ?? "198.51.100.1" }), ...options.headers }, body, duplex: "half",
  } as RequestInit), env, context);
  const send = (body: unknown = profile, options: SendOptions = {}) => raw(JSON.stringify(body), options);
  const success = async (guide = "g1") => { const challenge = await publicJoinChallenge(env, guide); return { success: true, hostname: "app.example.test", action: challenge.action, cdata: challenge.cData, "error-codes": [] }; };
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init?.method).toBe("POST"); return Response.json(await success());
  });
  vi.stubGlobal("fetch", fetch);
  const business = () => ({ influencers: db.prepare("SELECT count(*) AS n FROM influencers").all()[0]!.n, links: db.prepare("SELECT count(*) AS n FROM guide_influencers").all()[0]!.n, events: db.prepare("SELECT count(*) AS n FROM events").all()[0]!.n });
  return { db, env, send, raw, counted, fetch, success, business, context, batchChanges: () => batchChanges, setBeforeBatch: (fn?: () => void) => { beforeBatch = fn; }, setBeforeQuery: (fn?: (sql: string) => void) => { beforeQuery = fn; } };
}
const errorCode = async (response: Response) => (await response.json() as { error: { code: string } }).error.code;

describe("공개 join의 빠른 거절과 정확한 익명 route", () => {
  it.each([
    ["missing_token", { ...profile, turnstileToken: undefined }], ["empty_token", { ...profile, turnstileToken: "" }], ["whitespace_token", { ...profile, turnstileToken: "   " }], ["long_token", { ...profile, turnstileToken: "t".repeat(2049) }],
    ["bad_name", { ...profile, displayName: "" }], ["bad_email", { ...profile, email: "bad" }], ["bad_lang", { ...profile, lang: "jp" }], ["extra_capability", { ...profile, guideToken: "old-private-guide" }],
  ])("%s는 unknown sid cookie가 있어도 D1/HTTP를 호출하지 않는다", async (_name, body) => {
    const { send, counted, fetch, business } = await setup(); const response = await send(body, { headers: { Cookie: "sid=unknown-session" } });
    expect(response.status).toBe(400); expect(counted.getCalls()).toBe(0); expect(fetch).not.toHaveBeenCalled(); expect(business()).toEqual({ influencers: 1, links: 1, events: 0 });
  });

  it.each(["site", "secret", "hmac", "dummy", "hostname"])("%s 설정 실패도 0D1/0HTTP이며 운영 dummy fallback을 허용하지 않는다", async (missing) => {
    const { env, send, counted, fetch } = await setup();
    if (missing === "site") env.TURNSTILE_SITE_KEY = undefined;
    if (missing === "secret") env.TURNSTILE_SECRET_KEY = undefined;
    if (missing === "hmac") env.TOKEN_ENC_KEY = undefined;
    if (missing === "dummy") env.TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
    if (missing === "hostname") env.APP_URL = "not-a-url";
    expect((await send()).status).toBe(503); expect(counted.getCalls()).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });

  it.each([null, "not-an-ip", "999.1.2.3", "1.2.3.4, 5.6.7.8", "2001:db8:::1"])("잘못된 신뢰 IP %s는 원문을 저장하지 않고 0IO로 거절한다", async (ip) => {
    const { send, counted, fetch } = await setup(); expect((await send(profile, { ip })).status).toBe(503); expect(counted.getCalls()).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["malformed", "content_type", "truncated_stream"])("%s 본문도 0IO로 거절한다", async (kind) => {
    const { raw, counted, fetch } = await setup();
    const body = kind === "truncated_stream" ? new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("private-body-error")); } }) : kind === "malformed" ? "{" : JSON.stringify(profile);
    const response = await raw(body, kind === "content_type" ? { headers: { "Content-Type": "text/plain" } } : {});
    expect(response.status).toBe(400); expect(counted.getCalls()).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["declared", "stream", "utf8"])("8KiB %s 크기는 실제 stream/byte 경계로 막고 입력을 더 읽지 않는다", async (kind) => {
    const { raw, counted, fetch } = await setup(); let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(6000)); controller.enqueue(new Uint8Array(3000)); }, cancel() { cancelled = true; } });
    const text = JSON.stringify({ ...profile, displayName: "가".repeat(60) }).padEnd(PUBLIC_JOIN_MAX_BYTES, " ");
    const response = await raw(kind === "utf8" ? text : stream, { headers: { ...(kind === "declared" ? { "Content-Length": "10000" } : kind === "stream" ? { "Content-Length": "1" } : {}) } });
    expect(response.status).toBe(413); expect(await errorCode(response)).toBe("request_too_large");
    if (kind !== "utf8") expect(cancelled).toBe(true); expect(counted.getCalls()).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });

  it("다른 메서드·인증 경로에는 기존 세션 middleware를 적용한다", async () => {
    const { raw, counted, env } = await setup();
    const response = await raw("{}", { path: "/api/auth/logout", headers: { Cookie: "sid=unknown-session" } });
    expect(response.status).toBe(200); expect(counted.getCalls()).toBe(1);
    counted.reset();
    const get = await worker.fetch(new Request(`${ORIGIN}/api/public/guide/campaign-one/join`, { headers: { Cookie: "sid=unknown-session" } }), env, {} as ExecutionContext);
    expect(get.status).toBe(404); expect(counted.getCalls()).toBe(1);
  });
});

describe("서버 검증 뒤의 원자적 개인 가이드 생성", () => {
  it("정확히 8KiB 입력을 4D1+1HTTP로 처리하고 새 개인 토큰·언어·이벤트를 함께 저장한다", async () => {
    const { raw, db, counted, fetch, batchChanges } = await setup(); const json = JSON.stringify(profile), padding = PUBLIC_JOIN_MAX_BYTES - new TextEncoder().encode(json).byteLength;
    const response = await raw(json + " ".repeat(padding), { headers: { Cookie: "sid=unknown-session" } }); expect(response.status).toBe(201);
    const { guideToken } = await response.json() as { guideToken: string }; expect(guideToken).not.toBe("old-private-guide");
    expect(counted.getCalls()).toBe(4); expect(fetch).toHaveBeenCalledTimes(1);
    expect(batchChanges()).toEqual([1, 1, 1]);
    const row = db.prepare("SELECT i.workspace_id,i.email,i.ig_handle,i.lang,gi.* FROM guide_influencers gi JOIN influencers i ON i.id=gi.influencer_id WHERE gi.guide_token=?").all(guideToken)[0]!;
    expect(row).toMatchObject({ workspace_id: "w1", email: profile.email, ig_handle: "creator", lang: "en", guide_id: "g1", stage: "invited", token_expires_at: NOW + TOKEN_TTL_MS });
    expect(new Set([row.guide_token, row.upload_token, row.feedback_token, row.connect_token]).size).toBe(4);
    expect(db.prepare("SELECT name,props FROM events").all()).toEqual([{ name: "guide_link_issued", props: '{"guide_id":"g1"}' }]);
    const limits = db.prepare("SELECT * FROM public_join_limits").all(); expect(limits).toHaveLength(2);
    expect(limits.every((limit) => /^(ip|guide):\d+:[a-f0-9]{64}$/.test(String(limit.key)) && limit.hits === 1 && limit.expires_at === NOW + 16 * 60_000)).toBe(true);
    expect(JSON.stringify(limits)).not.toContain("198.51.100.1"); expect(JSON.stringify(limits)).not.toContain(profile.email); expect(JSON.stringify(limits)).not.toContain(profile.turnstileToken);
  });

  it.each(["missing", "draft", "old-private-guide"])("%s slug는 Siteverify·카운터·개인 행을 만들지 않는다", async (slug) => {
    const { send, counted, fetch, business, db } = await setup(); const response = await send(profile, { slug: slug === "draft" ? "draft-guide" : slug });
    expect(response.status).toBe(404); expect(counted.getCalls()).toBe(1); expect(fetch).not.toHaveBeenCalled(); expect(db.prepare("SELECT * FROM public_join_limits").all()).toHaveLength(0); expect(business()).toEqual({ influencers: 1, links: 1, events: 0 });
  });

  it.each(["invalid", "unavailable", "mismatch", "duplicate"])("%s 검증은 원장 예약만 남기고 가입 데이터를 만들지 않는다", async (kind) => {
    const { send, counted, fetch, success, business, db } = await setup();
    fetch.mockImplementation(async () => kind === "unavailable" ? new Response("private-provider-error", { status: 503 }) : kind === "mismatch" ? Response.json({ ...await success(), action: "other_action" }) : Response.json({ success: false, "error-codes": [kind === "duplicate" ? "timeout-or-duplicate" : "invalid-input-response"] }));
    expect((await send()).status).toBe(kind === "unavailable" ? 503 : 403); expect(counted.getCalls()).toBe(3); expect(fetch).toHaveBeenCalledTimes(1); expect(business()).toEqual({ influencers: 1, links: 1, events: 0 });
    expect(db.prepare("SELECT hits FROM public_join_limits").all()).toEqual([{ hits: 1 }, { hits: 1 }]);
  });

  it.each(["during_verify", "before_batch"])("%s의 비공개 전환을 최종 저장에서 거절한다", async (when) => {
    const { send, fetch, success, setBeforeBatch, db, business, batchChanges } = await setup();
    if (when === "during_verify") fetch.mockImplementationOnce(async () => { db.exec("UPDATE guides SET status='draft' WHERE id='g1'"); return Response.json(await success()); });
    else setBeforeBatch(() => db.exec("UPDATE guides SET status='draft' WHERE id='g1'"));
    expect((await send()).status).toBe(404); expect(business()).toEqual({ influencers: 1, links: 1, events: 0 });
    expect(batchChanges()).toEqual([0, 0, 0]);
  });

  it("검증 중 guide가 삭제돼도 최종 세 statement가 모두 0행이며 새 데이터가 없다", async () => {
    const { send, fetch, success, db, business, batchChanges } = await setup();
    fetch.mockImplementationOnce(async () => { const valid = await success("g2"); db.exec("DELETE FROM guides WHERE id='g2'"); return Response.json(valid); });
    expect((await send(profile, { slug: "campaign-two" })).status).toBe(404); expect(batchChanges()).toEqual([0, 0, 0]);
    expect(business()).toEqual({ influencers: 1, links: 1, events: 0 });
  });

  it("카운터 DB 실패도 Siteverify/가입으로 진행하지 않고 원문 오류를 정규화한다", async () => {
    const { send, fetch, setBeforeQuery, business } = await setup();
    setBeforeQuery((sql) => { if (sql.startsWith("INSERT INTO public_join_limits")) throw new Error("private-challenge-token creator@example.test 198.51.100.1"); });
    const response = await send(); expect(response.status).toBe(503); expect(fetch).not.toHaveBeenCalled();
    expect(business()).toEqual({ influencers: 1, links: 1, events: 0 });
    expect(await response.text() + JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/private-challenge-token|creator@example.test|198.51.100.1/);
  });

  it.each(["link", "event"])("%s 저장 실패는 전체 새 개인 데이터와 이벤트를 rollback하고 민감 오류를 숨긴다", async (where) => {
    const { send, db, business } = await setup();
    db.exec(`CREATE TRIGGER fail_join BEFORE INSERT ON ${where === "link" ? "guide_influencers" : "events"} BEGIN SELECT RAISE(ABORT,'private-name creator@example.test private-challenge-token'); END`);
    const response = await send(); expect(response.status).toBe(503); expect(business()).toEqual({ influencers: 1, links: 1, events: 0 });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls) + await response.text()).not.toMatch(/private-name|creator@example.test|private-challenge-token/);
    expect(db.prepare("SELECT hits FROM public_join_limits").all()).toEqual([{ hits: 1 }, { hits: 1 }]);
  });
});

describe("고정 시간창의 IP·guide 독립 원자 제한", () => {
  it("동시 요청도 IP cap을 넘지 않고 guide hopping으로 IP 제한을 우회하지 못한다", async () => {
    const { send, db, fetch } = await setup(); fetch.mockImplementation(async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] }));
    await send(); db.prepare("UPDATE public_join_limits SET hits=? WHERE key LIKE 'ip:%'").run(PUBLIC_JOIN_IP_LIMIT - 1); fetch.mockClear();
    const results = await Promise.all([send(), send(), send()]); expect(results.map((response) => response.status).sort()).toEqual([403, 429, 429]);
    expect(fetch).toHaveBeenCalledTimes(1); expect(db.prepare("SELECT hits FROM public_join_limits WHERE key LIKE 'ip:%'").all()).toEqual([{ hits: PUBLIC_JOIN_IP_LIMIT }]);
    const hopped = await send(profile, { slug: "campaign-two" }); expect(hopped.status).toBe(429); expect(Number(hopped.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(1); expect(db.prepare("SELECT hits FROM public_join_limits WHERE key LIKE 'guide:%'").all()).toHaveLength(1);
  });

  it("guide cap은 여러 IP의 합계에 원자 적용하고 다른 guide는 독립적이다", async () => {
    const { send, db, fetch } = await setup(); fetch.mockImplementation(async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] }));
    await send(); db.prepare("UPDATE public_join_limits SET hits=? WHERE key LIKE 'guide:%'").run(PUBLIC_JOIN_GUIDE_LIMIT - 1); fetch.mockClear();
    const results = await Promise.all([send(profile, { ip: "198.51.100.2" }), send(profile, { ip: "198.51.100.3" }), send(profile, { ip: "198.51.100.4" })]);
    expect(results.map((response) => response.status).sort()).toEqual([403, 429, 429]); expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT hits FROM public_join_limits WHERE key LIKE 'guide:%'").all()).toEqual([{ hits: PUBLIC_JOIN_GUIDE_LIMIT }]);
    expect((await send(profile, { slug: "campaign-two", ip: "198.51.100.5" })).status).toBe(403);
  });

  it("IPv6 표기와 시간창을 정규화하고 다음 창의 IP key를 분리한다", async () => {
    const { send, db, fetch } = await setup(); fetch.mockImplementation(async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] }));
    await send(profile, { ip: "2001:db8:0:0:0:0:0:1" }); await send(profile, { ip: "2001:DB8::1" });
    const old = db.prepare("SELECT key,hits FROM public_join_limits WHERE key LIKE 'ip:%'").all(); expect(old).toHaveLength(1); expect(old[0]?.hits).toBe(2);
    vi.mocked(Date.now).mockReturnValue(NOW + 60_000); await send(profile, { ip: "2001:db8::1" });
    const fresh = db.prepare("SELECT key FROM public_join_limits WHERE key LIKE 'ip:%' AND key<>?").all(String(old[0]!.key)); expect(fresh).toHaveLength(1);
    expect(String(fresh[0]?.key)).not.toContain("2001:db8");
  });

  it("만료 counter는 1000행·1D1씩 정리하며 살아 있는 창과 원문 없는 집계 로그를 보존한다", async () => {
    const { db, env, counted } = await setup();
    for (let n = 0; n < 1001; n++) db.prepare("INSERT INTO public_join_limits(key,hits,expires_at) VALUES (?,1,?)").run(`expired-private-fingerprint-${n}`, NOW);
    db.prepare("INSERT INTO public_join_limits(key,hits,expires_at) VALUES ('live',1,?)").run(NOW + 1);
    await cleanupPublicJoinLimits(env); expect(counted.getCalls()).toBe(1); expect(db.prepare("SELECT key FROM public_join_limits").all()).toHaveLength(2);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("private-fingerprint");
    await cleanupPublicJoinLimits(env); expect(counted.getCalls()).toBe(2); expect(db.prepare("SELECT key FROM public_join_limits").all()).toEqual([{ key: "live" }]);
  });

  it("cleanup 실패는 민감 오류 없이 Queue retry로 전파하고 다음 실행에 남은 counter를 삭제한다", async () => {
    const { db, env } = await setup(); db.exec("INSERT INTO public_join_limits(key,hits,expires_at) VALUES('expired',1,0)");
    db.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON public_join_limits BEGIN SELECT RAISE(ABORT,'private-fingerprint'); END");
    await expect(cleanupPublicJoinLimits(env)).rejects.toThrow("public_join_limits_cleanup_failed");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-fingerprint"); expect(db.prepare("SELECT key FROM public_join_limits").all()).toHaveLength(1);
    db.exec("DROP TRIGGER fail_cleanup"); await cleanupPublicJoinLimits(env); expect(db.prepare("SELECT key FROM public_join_limits").all()).toHaveLength(0);
  });
});
