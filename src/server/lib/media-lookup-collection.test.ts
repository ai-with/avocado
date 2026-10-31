import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, countD1Calls, type TestSqlite } from "../test/sqlite-d1";
import { processSnapshotCollection } from "./snapshots";
import { encryptToken } from "./crypto";
import { IG_SCOPES } from "../../shared/performance";

const NOW = 1_800_000_000_000;
const closes: (() => void)[] = [];
const target = { id: "cached-123", permalink: "https://www.instagram.com/reel/OLD/", timestamp: new Date(NOW - 72 * 3_600_000).toISOString(), media_type: "VIDEO", view_count: 222, like_count: 33, comments_count: 4 };
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { closes.splice(0).forEach((close) => close()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup() {
  const { db, d1, close } = await createSqliteD1(); closes.push(close); const counted = countD1Calls(d1);
  db.exec("INSERT INTO users(id,email,password_hash,name,created_at,phone_verified_at) VALUES('owner','owner@example.test','','QA',1,1)");
  db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w','QA',1),('other','OTHER',1)");
  db.exec("INSERT INTO members(workspace_id,user_id,role,created_at) VALUES('w','owner','owner',1)");
  db.exec("INSERT INTO brands(id,workspace_id,name,created_at) VALUES('brand','w','QA',1)");
  db.exec("INSERT INTO campaigns(id,workspace_id,brand_id,name,status,created_at,updated_at) VALUES('campaign','w','brand','QA','active',1,1)");
  db.exec("INSERT INTO guides(id,workspace_id,campaign_id,name,slug,status,extra_rules,product,deliverables,secondary_use_scope,created_at,updated_at) VALUES('guide','w','campaign','QA','qa-slug','published','[]','{}','{}','{}',1,1)");
  db.exec("INSERT INTO influencers(id,workspace_id,display_name,ig_handle,email,created_at) VALUES('creator','w','QA','creator','creator@example.test',1)");
  db.prepare("INSERT INTO guide_influencers(id,guide_id,influencer_id,guide_token,upload_token,feedback_token,connect_token,token_expires_at,created_at) VALUES('gi','guide','creator','guide-token','upload-token','feedback-token','connect-token',?,1)").run(NOW + 86_400_000);
  db.prepare("INSERT INTO contents(id,guide_id,influencer_id,guide_influencer_id,url,ig_media_id,format,posted_at,posted_at_source,url_submitted_by,registered_at) VALUES('content','guide','creator','gi',?,'cached-123','reel',?,'api','brand',?)").run(target.permalink, NOW - 72 * 3_600_000, NOW - 72 * 3_600_000);
  db.prepare("INSERT INTO metric_snapshots(id,content_id,offset_h,scheduled_at,status,missing,path,views,captured_at) VALUES('past','content',24,?,'captured','{}','discovery',111,?)").run(NOW - 48 * 3_600_000, NOW - 48 * 3_600_000);
  db.prepare("INSERT INTO metric_snapshots(id,content_id,offset_h,scheduled_at,status,missing) VALUES('due','content',72,?,'scheduled','{}'),('future','content',168,?,'scheduled','{}')").run(NOW, NOW + 96 * 3_600_000);
  const env = { DB: counted.d1, TOKEN_ENC_KEY: "fake-key", IG_SYSTEM_TOKEN: "FB_ONLY_TOKEN", IG_SYSTEM_USER_ID: "system-user", APP_URL: "https://app.example.test", RESEND_API_KEY: "fake-resend-key", EMAIL_FROM: "no-reply@example.test", PIPELINE: { sendBatch: vi.fn(async () => {}), send: vi.fn(async () => {}) } } as unknown as Env;
  let direct: () => Promise<Response> = async () => Response.json(target);
  let recent: () => Promise<Response> = async () => Response.json({ business_discovery: { media: { data: [], paging: { next: "https://evil.example/?access_token=SHOULD_NOT_FOLLOW", cursors: { after: "next-cursor" } } } } });
  const provider = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(String(input));
    if (["graph.facebook.com", "graph.instagram.com"].includes(url.hostname)) return url.pathname.endsWith("/cached-123") ? direct() : recent();
    if (url.hostname === "api.resend.com") return Response.json({ id: "SHOULD_NOT_SEND_DELETION_MAIL" });
    throw new Error("unexpected request");
  });
  vi.stubGlobal("fetch", provider);
  const run = () => processSnapshotCollection({ snapshotId: "due" }, env);
  const row = (id: string) => db.prepare("SELECT * FROM metric_snapshots WHERE id=?").all(id)[0]!;
  const expectPreserved = () => { expect(row("past")).toMatchObject({ status: "captured", views: 111 }); expect(row("future")).toMatchObject({ status: "scheduled", views: null }); expect(provider.mock.calls.some(([url]) => String(url).includes("resend.com"))).toBe(false); };
  const brand = async (workspace = "w") => {
    env.IG_SYSTEM_TOKEN = undefined; env.IG_SYSTEM_USER_ID = undefined;
    db.prepare("INSERT INTO ig_connections(id,workspace_id,target,ig_user_id,account_type,scopes,token_enc,expires_at,connected_at,generation,grants_verified_at,created_at) VALUES('sender',?,'brand_sender','brand-user','BUSINESS',?,?,?,?,'generation',?,1)")
      .run(workspace, JSON.stringify(IG_SCOPES.brand_sender), await encryptToken("fake-key", "IG_ONLY_TOKEN"), NOW + 3_600_000, NOW, NOW);
  };
  return { db, env, counted, provider, run, row, expectPreserved, brand, direct: (fn: () => Promise<Response>) => { direct = fn; }, recent: (fn: () => Promise<Response>) => { recent = fn; } };
}

// 변경 전: cached ID가 있어도 최근 50개에서 빠지면 deleted, 이후 예약 취소와 삭제 메일.
// 변경 후: 같은 ID/shortcode 직접 조회 성공은 수집, 100/33·권한 불명확은 조회 불가.
// 아래 두 경로 모두 과거 24h=111과 이후 168h 예약을 보존하고 삭제 메일 0회를 검증한다.
// 이 기록은 로컬 재현이며 AIWITH-401의 50개 초과 실제 계정 QA를 대체하지 않는다.
describe("AIWITH-294의 최근 50개 밖 게시물 오판 회귀", () => {
  it.each([false, true])("이전에는 deleted였던 51번째 게시물을 cached ID로 복구한다(next=%s)", async (next) => {
    const { run, provider, row, recent, expectPreserved, db, counted } = await setup();
    recent(async () => Response.json({ business_discovery: { media: { data: Array.from({ length: 50 }, (_, n) => ({ ...target, id: `recent-${n}`, permalink: `https://www.instagram.com/reel/RECENT${n}/` })), ...(next ? { paging: { next: "https://evil.example/?access_token=DO_NOT_FOLLOW" } } : {}) } } }));
    await run(); expect(row("due")).toMatchObject({ status: "captured", path: "discovery", views: 222, likes: 33 }); expectPreserved();
    expect(provider).toHaveBeenCalledTimes(2); expect(counted.getCalls()).toBeLessThanOrEqual(15);
    const [list, direct] = provider.mock.calls.map(([url]) => new URL(String(url)));
    expect(list!.hostname).toBe("graph.facebook.com"); expect(direct!.hostname).toBe("graph.facebook.com"); expect(direct!.pathname).toBe("/v26.0/cached-123");
    expect(list!.searchParams.get("access_token")).toBe("FB_ONLY_TOKEN"); expect(direct!.searchParams.get("access_token")).toBe("FB_ONLY_TOKEN");
    const audit = JSON.parse(String(db.prepare("SELECT props FROM events WHERE name='snapshot_captured'").all()[0]!.props));
    expect(audit).toMatchObject({ lookup_method: "cached_id", lookup_result: "found" }); expect(JSON.stringify(audit)).not.toMatch(/TOKEN|access_token|evil\.example/);
  });

  it("캐시 ID가 없으면 shortcode를 ID로 추정하지 않고 조회 불가로 남긴다", async () => {
    const { db, run, row, provider, expectPreserved } = await setup(); db.exec("UPDATE contents SET ig_media_id=NULL");
    await run(); expect(row("due")).toMatchObject({ status: "missing", views: null }); expect(JSON.parse(String(row("due").missing)).views).toBe("private_or_unavailable");
    expect(provider).toHaveBeenCalledTimes(1); expectPreserved();
  });

  it.each([100, 10, 200])("direct code%s의 삭제/권한 모호성을 future cancel·삭제메일로 바꾸지 않는다", async (code) => {
    const { direct, run, row, expectPreserved, db } = await setup();
    direct(async () => Response.json({ error: { code, ...(code === 100 ? { error_subcode: 33 } : {}), message: "private-provider-message FB_ONLY_TOKEN" } }, { status: 400 }));
    await run(); expect(row("due")).toMatchObject({ status: "missing", views: null }); expect(JSON.parse(String(row("due").missing)).views).toBe("private_or_unavailable"); expectPreserved();
    const event = JSON.parse(String(db.prepare("SELECT props FROM events WHERE name='snapshot_missing'").all()[0]!.props));
    expect(event).toMatchObject({ reason: "private_or_unavailable", lookup_method: "cached_id", lookup_result: "unavailable", provider_code: code });
    expect(JSON.stringify(event)).not.toMatch(/private-provider-message|FB_ONLY_TOKEN/);
  });

  it.each(["wrong_id", "wrong_shortcode", "malformed", "bad_json"])("%s 성공 응답도 다른 게시물 수치나 삭제 확정으로 저장하지 않는다", async (kind) => {
    const { direct, run, row, expectPreserved } = await setup();
    direct(async () => kind === "bad_json" ? new Response("not json") : Response.json(kind === "malformed" ? {} : { ...target, ...(kind === "wrong_id" ? { id: "wrong-id" } : { permalink: "https://www.instagram.com/reel/OLDER/" }) }));
    await run(); expect(row("due")).toMatchObject({ status: "missing", views: null }); expect(JSON.parse(String(row("due").missing)).views).toBe("api_error"); expectPreserved();
  });

  it("일시 실패는 최대 5회만 재시도하며 과거 수치와 미래 예약을 유지한다", async () => {
    const { direct, run, row, expectPreserved, provider, counted } = await setup(); direct(async () => Response.json({ error: { code: 2, is_transient: true } }, { status: 503 }));
    for (let n = 1; n <= 5; n++) { counted.reset(); await run(); expect(row("due").attempts).toBe(n); expect(row("due").status).toBe(n < 5 ? "scheduled" : "missing"); expect(counted.getCalls()).toBeLessThanOrEqual(15); expectPreserved(); }
    const count = provider.mock.calls.length; await run(); expect(provider.mock.calls).toHaveLength(count);
    expect(JSON.parse(String(row("due").missing)).views).toBe("api_error");
  });

  it("네트워크 실패는 같은 invocation에서 반복 발송하지 않고 재예약한다", async () => {
    const { direct, run, row, expectPreserved, provider } = await setup(); direct(async () => { throw new Error("FB_ONLY_TOKEN private-provider-error"); });
    await run(); expect(provider).toHaveBeenCalledTimes(2); expect(row("due")).toMatchObject({ status: "scheduled", attempts: 1, views: null }); expectPreserved();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/FB_ONLY_TOKEN|private-provider-error/);
  });

  it("숫자가 아닌 provider code도 원문 대신 null로 기록한다", async () => {
    const { direct, run, db, expectPreserved } = await setup();
    direct(async () => Response.json({ error: { code: "FB_ONLY_TOKEN", message: "private-provider-message" } }, { status: 400 }));
    await run(); expectPreserved();
    const event = JSON.parse(String(db.prepare("SELECT props FROM events WHERE name='snapshot_lookup_retry'").all()[0]!.props));
    expect(event.provider_code).toBeNull(); expect(JSON.stringify(event)).not.toMatch(/FB_ONLY_TOKEN|private-provider-message/);
  });

  it("미디어 ID만으로 조회 가능할 때는 현재 handle이 없어도 같은 ID를 확인한다", async () => {
    const { db, run, row, provider, expectPreserved } = await setup(); db.exec("UPDATE influencers SET ig_handle=NULL");
    await run(); expect(row("due").views).toBe(222); expect(provider).toHaveBeenCalledTimes(1); expectPreserved();
  });

  it("recent window에서 찾으면 추가 ID 조회 없이 기존 경로를 유지한다", async () => {
    const { recent, run, row, provider, expectPreserved } = await setup(); recent(async () => Response.json({ business_discovery: { media: { data: [target] } } }));
    await run(); expect(row("due").views).toBe(222); expect(provider).toHaveBeenCalledTimes(1); expectPreserved();
  });
});

describe("lookup의 권한·URL·캠페인 세대 경계", () => {
  it("owner token 만료 뒤 별도 FB discovery token만 사용하며 Free 호출 예산을 지킨다", async () => {
    const { db, env, run, row, provider, counted, expectPreserved } = await setup();
    db.prepare("INSERT INTO ig_connections(id,workspace_id,influencer_id,target,ig_user_id,account_type,scopes,token_enc,expires_at,connected_at,generation,grants_verified_at,created_at) VALUES('own','w','creator','influencer','owner-ig-user','BUSINESS',?,?,?,?,'owner-generation',?,1)")
      .run(JSON.stringify(IG_SCOPES.influencer), await encryptToken("fake-key", "IG_OWNER_TOKEN"), NOW + 3_600_000, NOW, NOW);
    provider.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "graph.instagram.com") return Response.json({ error: { code: 190 } }, { status: 400 });
      if (url.hostname === "graph.facebook.com") return url.pathname.endsWith("cached-123") ? Response.json(target) : Response.json({ business_discovery: { media: { data: [] } } });
      throw new Error("unexpected external effect");
    });
    await run(); expect(row("due").views).toBe(222); expectPreserved(); expect(provider).toHaveBeenCalledTimes(3);
    const urls = provider.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls[0]!.searchParams.get("access_token")).toBe("IG_OWNER_TOKEN");
    for (const url of urls.slice(1)) { expect(url.hostname).toBe("graph.facebook.com"); expect(url.searchParams.get("access_token")).toBe("FB_ONLY_TOKEN"); }
    expect(db.prepare("SELECT token_enc,disconnected_reason FROM ig_connections WHERE id='own'").all()[0]).toEqual({ token_enc: null, disconnected_reason: "provider_auth_invalid" });
    expect(counted.getCalls() + provider.mock.calls.length + vi.mocked(env.PIPELINE.sendBatch).mock.calls.length).toBeLessThanOrEqual(50);
  });

  it("Instagram Login token을 Facebook host로 보내지 않고 누락 지표를 0으로 채우지 않는다", async () => {
    const { brand, direct, run, row, provider, expectPreserved } = await setup(); await brand();
    direct(async () => Response.json({ id: target.id, permalink: target.permalink, timestamp: target.timestamp }));
    await run(); expect(row("due")).toMatchObject({ status: "missing", views: null, likes: null }); expectPreserved(); expect(provider).toHaveBeenCalledTimes(2);
    for (const [url] of provider.mock.calls) { const parsed = new URL(String(url)); expect(parsed.hostname).toBe("graph.instagram.com"); expect(parsed.searchParams.get("access_token")).toBe("IG_ONLY_TOKEN"); }
  });

  it("recent 조회 중 연결이 해제되면 이전 token으로 새 direct HTTP를 시작하지 않는다", async () => {
    const { brand, recent, run, db, row, provider, expectPreserved } = await setup(); await brand();
    recent(async () => { db.exec("UPDATE ig_connections SET generation='new-generation',token_enc=NULL,disconnected_at=1,disconnected_reason='manual'"); return Response.json({ business_discovery: { media: { data: [] } } }); });
    await run(); expect(row("due").views).toBeNull(); expect(provider).toHaveBeenCalledTimes(1); expectPreserved();
  });

  it("다른 workspace의 연결을 가져와 미디어 ID를 조회하지 않는다", async () => {
    const { brand, run, provider, row, expectPreserved } = await setup(); await brand("other");
    await run(); expect(provider).not.toHaveBeenCalled(); expect(row("due").views).toBeNull(); expectPreserved();
  });

  it("direct 응답 중 연결 generation이 바뀌면 이전 권한의 수치를 저장하지 않는다", async () => {
    const { brand, direct, run, db, row, expectPreserved } = await setup(); await brand();
    direct(async () => { db.exec("UPDATE ig_connections SET generation='new-generation',token_enc=NULL,disconnected_at=1,disconnected_reason='manual'"); return Response.json(target); });
    await run(); expect(row("due").views).toBeNull(); expectPreserved();
  });

  it.each(["replace", "campaign_end"])("recent 조회 중 %s 변경이 오면 direct 조회·최종 쓰기를 막는다", async (kind) => {
    const { recent, run, db, row, provider } = await setup();
    recent(async () => { if (kind === "replace") db.exec("UPDATE contents SET url='https://www.instagram.com/reel/NEW/',collection_revision=1,ig_media_id=NULL"); else db.prepare("UPDATE campaigns SET ends_at=?").run(NOW - 7 * 86_400_000); return Response.json({ business_discovery: { media: { data: [] } } }); });
    await run(); expect(provider).toHaveBeenCalledTimes(1); expect(row("due").views).toBeNull(); expect(row("past").views).toBe(111);
  });

  it.each(["replace", "campaign_end"])("direct 응답 중 %s 변경도 최종 수치 쓰기에서 차단한다", async (kind) => {
    const { direct, run, db, row, provider } = await setup();
    direct(async () => { if (kind === "replace") db.exec("UPDATE contents SET url='https://www.instagram.com/reel/NEW/',collection_revision=1,ig_media_id=NULL"); else db.prepare("UPDATE campaigns SET ends_at=?").run(NOW - 7 * 86_400_000); return Response.json(target); });
    await run(); expect(provider).toHaveBeenCalledTimes(2); expect(row("due")).toMatchObject({ status: "cancelled", views: null }); expect(row("past").views).toBe(111);
  });
});
