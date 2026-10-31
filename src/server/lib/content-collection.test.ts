import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { getDb } from "../db";
import type { AppEnv, Auth } from "../types";
import { createSqliteD1, countD1Calls, type TestSqlite } from "../test/sqlite-d1";
import { contents } from "../db/schema";
import { eq } from "drizzle-orm";
import { encryptToken } from "./crypto";
import { collectionState, COLLECTION_GRACE_MS } from "./content-collection";
import { ownedThumbnailKey, processThumbnailCleanup, processThumbnailSweep, saveContentThumbnail, thumbnailSource, THUMBNAIL_MAX_BYTES, THUMBNAIL_TIMEOUT_MS, THUMBNAIL_ORPHAN_GRACE_MS } from "./content-thumbnail";
import { mediaMetadata, mediaThumbnailUrl } from "./instagram";
import { processSnapshotCollection, runDueSnapshots, scheduleSnapshots } from "./snapshots";
import { contentHooks, registerContent } from "./contents";
import { performanceRoutes, performanceRows, performanceCells, performanceCsv } from "../routes/performance";
import { campaignRoutes } from "../routes/campaigns";
import { ApiError, errorBody } from "./errors";
import worker from "../index";
import type { PipelineMessage } from "../jobs";

const NOW = Date.parse("2026-11-01T06:00:00Z");
const IMAGE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const CDN = "https://scontent.cdninstagram.com/post.jpg?expires=soon";
const closes: (() => void)[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { for (const close of closes.splice(0)) close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

class FakeR2 {
  objects = new Map<string, { bytes: Uint8Array; type: string }>();
  beforePut?: () => Promise<void>;
  failDelete = false;
  losePutResponse = false;
  async put(key: string, body: Uint8Array, options: { httpMetadata: { contentType: string } }) {
    await this.beforePut?.(); this.objects.set(key, { bytes: body, type: options.httpMetadata.contentType });
    if (this.losePutResponse) throw new Error("R2 put response lost");
    return {};
  }
  async delete(key: string | string[]) { if (this.failDelete) throw new Error("R2 deletion failed"); for (const item of Array.isArray(key) ? key : [key]) this.objects.delete(item); }
  async get(key: string) {
    const object = this.objects.get(key);
    return object ? { size: object.bytes.length, body: new Response(object.bytes).body, httpMetadata: { contentType: object.type } } : null;
  }
}

async function setup() {
  const base = await createSqliteD1(); closes.push(base.close);
  const { db } = base;
  const counted = countD1Calls(base.d1);
  const orm = getDb(counted.d1);
  db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w','team',1),('other','other-team',1)");
  db.exec("INSERT INTO brands(id,workspace_id,name,created_at) VALUES('brand','w','brand',1)");
  db.exec("INSERT INTO campaigns(id,workspace_id,brand_id,name,status,created_at,updated_at) VALUES('campaign','w','brand','campaign','active',1,1)");
  db.exec("INSERT INTO guides(id,workspace_id,campaign_id,name,slug,status,extra_rules,product,deliverables,secondary_use_scope,created_at,updated_at) VALUES('g','w','campaign','guide','guide-slug','published','[]','{}','{}','{}',1,1)");
  db.exec("INSERT INTO influencers(id,workspace_id,display_name,ig_handle,created_at) VALUES('i','w','creator','creator',1)");
  db.prepare("INSERT INTO guide_influencers(id,guide_id,influencer_id,guide_token,upload_token,feedback_token,connect_token,token_expires_at,created_at) VALUES('gi','g','i','guide-token','upload-token','feedback-token','connect-token',?,1)").run(NOW + 86_400_000);
  db.prepare("INSERT INTO contents(id,guide_id,influencer_id,guide_influencer_id,url,ig_media_id,format,posted_at,posted_at_source,url_submitted_by,registered_at) VALUES('post','g','i','gi','https://www.instagram.com/reel/OLD/', 'media', 'reel', ?, 'api', 'brand', ?)").run(NOW - 24 * 3_600_000, NOW - 24 * 3_600_000);
  db.prepare("INSERT INTO metric_snapshots(id,content_id,offset_h,scheduled_at,status,missing) VALUES('snap','post',24,?,'scheduled','{}')").run(NOW);
  db.prepare("INSERT INTO ig_connections(id,workspace_id,influencer_id,target,ig_user_id,scopes,token_enc,expires_at,connected_at,created_at) VALUES('conn','w','i','influencer','ig-user','[\"instagram_business_basic\",\"instagram_business_manage_insights\"]',?,?,1,1)").run(await encryptToken("key", "token"), NOW + 86_400_000);
  const r2 = new FakeR2();
  const messages: PipelineMessage[] = [];
  const env = { DB: counted.d1, FILES: r2 as unknown as R2Bucket, TOKEN_ENC_KEY: "key", APP_URL: "https://app.example.com", PIPELINE: {
    sendBatch: vi.fn(async (batch: { body: PipelineMessage }[]) => { messages.push(...batch.map((item) => item.body)); }),
    send: vi.fn(async (body: PipelineMessage) => { messages.push(body); }),
  } } as unknown as Env;
  const provider = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "graph.instagram.com" && url.pathname.endsWith("/insights")) return Response.json({ data: [{ name: "views", values: [{ value: 123 }] }, { name: "likes", values: [{ value: 4 }] }] });
    if (url.hostname === "graph.instagram.com") return Response.json({ id: "media", permalink: "https://www.instagram.com/reel/OLD/", timestamp: new Date(NOW - 86_400_000).toISOString(), media_type: "VIDEO", thumbnail_url: CDN });
    return new Response(IMAGE, { headers: { "content-type": "image/jpeg" } });
  });
  vi.stubGlobal("fetch", provider);
  const auth = (workspaceId: string): Auth => ({ sessionId: "session", user: { id: "u", name: "name", email: "owner@example.com" }, role: "owner", phone: null, phoneVerified: true, workspace: { id: workspaceId, name: workspaceId, plan: "starter", onboardedAt: 1 } });
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", orm); c.set("auth", c.req.header("x-auth") === "none" ? null : auth(c.req.header("x-workspace") ?? "w")); await next(); });
  app.route("/api/performance", performanceRoutes); app.route("/api/campaigns", campaignRoutes);
  app.onError((error, c) => error instanceof ApiError ? c.json(errorBody(error.code, error.message), error.status) : c.text(String(error), 500));
  const call = (path: string, options: { method?: string; body?: unknown; workspace?: string; noAuth?: boolean } = {}) => app.request(path, { method: options.method ?? (options.body ? "PATCH" : "GET"), headers: { "content-type": "application/json", "x-workspace": options.workspace ?? "w", "x-auth": options.noAuth ? "none" : "yes" }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) }, env);
  const content = async () => (await orm.select().from(contents).where(eq(contents.id, "post")).get())!;
  return { db, orm, counted, r2, messages, env, provider, call, content };
}
const first = (db: TestSqlite, sql: string) => db.prepare(sql).all()[0]!;

describe("명시적 캠페인 종료 기준", () => {
  it("7일 경계와 과거 보관 시각 미확정을 구별하고 업로드 마감을 추정하지 않는다", () => {
    expect(collectionState({ status: "active", endsAt: null }, NOW)).toEqual({ endsAt: null, stoppedReason: null });
    expect(collectionState({ status: "archived", endsAt: null }, NOW).stoppedReason).toBe("campaign_end_unknown");
    expect(collectionState({ status: "active", endsAt: NOW - COLLECTION_GRACE_MS }, NOW).stoppedReason).toBe("campaign_ended");
    expect(collectionState({ status: "archived", endsAt: NOW - COLLECTION_GRACE_MS + 1 }, NOW).stoppedReason).toBeNull();
    expect(collectionState(null, NOW).stoppedReason).toBe("campaign_missing");
  });

  it("보관은 종료 입력이 필요하고 실제 전이 시각만 기록하며 legacy 보관 시각은 채워 넣지 않는다", async () => {
    const { db, call } = await setup();
    expect((await call("/api/campaigns/campaign", { body: { status: "archived" } })).status).toBe(400);
    expect((await call("/api/campaigns/campaign", { body: { endsAt: NOW, status: "archived" } })).status).toBe(200);
    expect(first(db, "SELECT ends_at,archived_at FROM campaigns")).toEqual({ ends_at: NOW, archived_at: NOW });
    expect((await call("/api/campaigns/campaign", { body: { status: "active" } })).status).toBe(200);
    expect(first(db, "SELECT archived_at FROM campaigns").archived_at).toBe(NOW);
    db.exec("UPDATE campaigns SET status='archived',ends_at=NULL,archived_at=NULL");
    expect((await call("/api/campaigns/campaign", { body: { name: "edited" } })).status).toBe(200);
    expect(first(db, "SELECT archived_at FROM campaigns").archived_at).toBeNull();
  });

  it.each(["ended", "legacy"])("%s 캠페인은 Cron·수동 재수집·수동 게시 시각 변경에서 외부 호출을 하지 않는다", async (kind) => {
    const { db, env, provider, messages, call } = await setup();
    db.prepare("UPDATE campaigns SET status='archived',ends_at=?").run(kind === "ended" ? NOW - COLLECTION_GRACE_MS : null);
    expect(await runDueSnapshots(env)).toEqual({ processed: 0 }); expect(messages).toHaveLength(0);
    await processSnapshotCollection({ snapshotId: "snap" }, env);
    expect(provider).not.toHaveBeenCalled();
    expect(first(db, "SELECT status FROM metric_snapshots").status).toBe("cancelled");
    expect((await call("/api/performance/contents/post/retry", { method: "POST" })).status).toBe(409);
    expect((await call("/api/performance/contents/post/posted-at", { body: { postedAt: NOW - 1000 } })).status).toBe(409);
  });

  it("진행 중인 provider 응답이 종료 경계 뒤에 와도 지표나 썸네일을 쓰지 않는다", async () => {
    const { db, env, provider, r2 } = await setup();
    db.prepare("UPDATE campaigns SET ends_at=?").run(NOW - COLLECTION_GRACE_MS + 1);
    provider.mockImplementationOnce(async () => { vi.spyOn(Date, "now").mockReturnValue(NOW + 1); return Response.json({ data: [{ name: "views", values: [{ value: 777 }] }] }); });
    await processSnapshotCollection({ snapshotId: "snap" }, env);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(first(db, "SELECT views,status,missing FROM metric_snapshots")).toMatchObject({ views: null, status: "cancelled", missing: '{"_":"campaign_ended"}' });
    expect(r2.objects.size).toBe(0);
  });
});

describe("미디어 썸네일 사본·소유권", () => {
  it("Meta v26 메타데이터 필드와 영상/이미지 선택 계약을 따른다", async () => {
    const { env, provider } = await setup();
    const result = await mediaMetadata(env, "token", "media"); expect(result.ok).toBe(true);
    const url = new URL(String(provider.mock.calls[0]![0]));
    expect(url.pathname).toBe("/v26.0/media");
    expect(url.searchParams.get("fields")).toBe("id,permalink,timestamp,media_type,thumbnail_url,media_url");
    expect(mediaThumbnailUrl({ media_type: "VIDEO", media_url: "https://cdn/video.mp4", thumbnail_url: CDN })).toBe(CDN);
    expect(mediaThumbnailUrl({ media_type: "VIDEO", media_url: "https://cdn/video.mp4" })).toBeNull();
    expect(mediaThumbnailUrl({ media_type: "IMAGE", media_url: CDN })).toBe(CDN);
  });

  it("짧게 만료되는 CDN 주소를 R2로 복사하고 인증된 자기 워크스페이스에서만 읽는다", async () => {
    const { db, env, r2, call, orm } = await setup();
    await processSnapshotCollection({ snapshotId: "snap" }, env);
    const row = first(db, "SELECT thumbnail_url,thumbnail_key,thumbnail_fetched_at FROM contents");
    expect(row.thumbnail_url).toBe(CDN); expect(row.thumbnail_fetched_at).toBe(NOW);
    expect(ownedThumbnailKey(String(row.thumbnail_key), "w", "post")).toBe(true); expect(r2.objects.size).toBe(1);
    const rows = await performanceRows(orm, "w", {});
    expect(rows[0]!.thumbnailUrl).toBe("/api/performance/contents/post/thumbnail");
    expect((await call(rows[0]!.thumbnailUrl!)).status).toBe(200);
    expect((await call(rows[0]!.thumbnailUrl!, { workspace: "other" })).status).toBe(404);
    expect((await call(rows[0]!.thumbnailUrl!, { noAuth: true })).status).toBe(401);
    db.exec("UPDATE contents SET thumbnail_key='originals/g/gi/private.mp4'");
    expect((await call("/api/performance/contents/post/thumbnail")).status).toBe(404);
  });

  it.each(["replace", "delete", "end", "aba"])("R2 put 중 %s가 발생하면 늦은 사본을 연결하지 않고 보상 삭제한다", async (change) => {
    const { db, env, orm, r2 } = await setup();
    r2.beforePut = async () => {
      r2.beforePut = undefined;
      if (change === "replace") await registerContent(env, orm, { workspaceId: "w", guideId: "g", influencerId: "i", guideInfluencerId: "gi", url: "https://www.instagram.com/reel/NEW/", by: "brand", replace: true });
      else if (change === "delete") db.exec("DELETE FROM contents WHERE id='post'");
      else if (change === "aba") db.exec("UPDATE contents SET url='https://www.instagram.com/reel/NEW/',collection_revision=1; UPDATE contents SET url='https://www.instagram.com/reel/OLD/',collection_revision=2");
      else db.prepare("UPDATE campaigns SET ends_at=?").run(NOW - COLLECTION_GRACE_MS);
    };
    await processSnapshotCollection({ snapshotId: "snap" }, env);
    expect(r2.objects.size).toBe(0);
    expect(db.prepare("SELECT id FROM contents WHERE thumbnail_key IS NOT NULL").all()).toEqual([]);
    if (change === "replace") {
      expect(first(db, "SELECT url,collection_revision FROM contents")).toEqual({ url: "https://www.instagram.com/reel/NEW/", collection_revision: 1 });
      expect(db.prepare("SELECT id FROM metric_snapshots WHERE views IS NOT NULL").all()).toEqual([]);
    }
  });

  it("미연결 discovery도 Meta CDN 사본을 저장하며 shortcode 접두어가 같은 다른 게시물을 고르지 않는다", async () => {
    const { db, env, provider } = await setup(); db.exec("DELETE FROM ig_connections");
    env.IG_SYSTEM_TOKEN = "system-token"; env.IG_SYSTEM_USER_ID = "system-user";
    provider.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "graph.facebook.com") return Response.json({ business_discovery: { media: { data: [
        { id: "wrong", permalink: "https://www.instagram.com/reel/OLDER/", timestamp: new Date(NOW - 86_400_000).toISOString(), media_type: "VIDEO", thumbnail_url: "https://scontent.cdninstagram.com/wrong.jpg", view_count: 999 },
        { id: "right", permalink: "https://www.instagram.com/reel/OLD/", timestamp: new Date(NOW - 86_400_000).toISOString(), media_type: "VIDEO", thumbnail_url: CDN, view_count: 456 },
      ] } } });
      return new Response(IMAGE, { headers: { "content-type": "image/jpeg" } });
    });
    await processSnapshotCollection({ snapshotId: "snap" }, env);
    expect(first(db, "SELECT views,path FROM metric_snapshots")).toEqual({ views: 456, path: "discovery" });
    expect(first(db, "SELECT thumbnail_url FROM contents").thumbnail_url).toBe(CDN);
    expect(new URL(String(provider.mock.calls[0]![0])).pathname).toBe("/v26.0/system-user");
  });

  it("썸네일 보상 삭제 실패는 별도 Queue에 남기고 현재 참조나 다른 객체는 지우지 않는다", async () => {
    const { db, env, orm, r2, messages, content } = await setup();
    r2.beforePut = async () => { db.exec("UPDATE contents SET collection_revision=1"); r2.failDelete = true; };
    expect(await saveContentThumbnail(env, orm, "w", await content(), CDN)).toBe(false);
    const job = messages.find((message) => message.type === "cleanup_content_thumbnail")!;
    expect(job).toBeDefined(); expect(r2.objects.size).toBe(1);
    r2.failDelete = false;
    const key = [...r2.objects.keys()][0]!;
    db.prepare("UPDATE contents SET thumbnail_key=?").run(key);
    await processThumbnailCleanup(job.payload, env); expect(r2.objects.size).toBe(1);
    db.exec("UPDATE contents SET thumbnail_key=NULL");
    await processThumbnailCleanup(job.payload, env); expect(r2.objects.size).toBe(0);
    await expect(processThumbnailCleanup({ workspaceId: "w", contentId: "post", key: "originals/g/gi/secret.mp4" }, env)).rejects.toThrow();
  });

  it("CDN만 허용하고 위험한 redirect·MIME·본문 크기를 거절한다", async () => {
    const { env, orm, provider, r2, content } = await setup();
    for (const raw of ["http://scontent.cdninstagram.com/a.jpg", "https://127.0.0.1/a", "https://cdninstagram.com.evil.test/a", "https://x:pass@scontent.cdninstagram.com/a", "https://scontent.cdninstagram.com:123/a"]) expect(thumbnailSource(raw)).toBeNull();
    provider.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }));
    await expect(saveContentThumbnail(env, orm, "w", await content(), CDN)).rejects.toThrow("thumbnail_redirect_rejected");
    provider.mockResolvedValueOnce(new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }));
    await expect(saveContentThumbnail(env, orm, "w", await content(), CDN)).rejects.toThrow("thumbnail_response_rejected");
    provider.mockResolvedValueOnce(new Response(new Uint8Array(THUMBNAIL_MAX_BYTES + 1), { headers: { "content-type": "image/jpeg" } }));
    await expect(saveContentThumbnail(env, orm, "w", await content(), CDN)).rejects.toThrow("thumbnail_too_large");
    expect(r2.objects.size).toBe(0);
  });

  it("응답이 멈추면 총 시간 제한으로 중단한다", async () => {
    const { env, orm, provider, content } = await setup(); const row = await content();
    vi.useFakeTimers();
    provider.mockImplementation((_url, init?: RequestInit) => new Promise((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))); }));
    const pending = saveContentThumbnail(env, orm, "w", row, CDN);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(THUMBNAIL_TIMEOUT_MS + 1);
    await assertion;
  });
});

describe("스냅샷별 Queue와 기존 내보내기 계약", () => {
  it("Cron은 ID만 전송하고 실제 Worker Queue가 한 건씩 수집하며 호출 예산을 분리한다", async () => {
    const { env, counted, messages, provider, db } = await setup();
    const waiting: Promise<unknown>[] = [];
    await worker.scheduled({ scheduledTime: NOW, cron: "*/15 * * * *", noRetry() {} }, env, { waitUntil: (promise: Promise<unknown>) => waiting.push(promise) } as unknown as ExecutionContext);
    await Promise.all(waiting);
    expect(provider).not.toHaveBeenCalled();
    const message = messages.find((entry) => entry.type === "collect_snapshot")!; expect(message).toBeDefined();
    const ack = vi.fn(), retry = vi.fn(); counted.reset();
    await worker.queue({ queue: "avocado-pipeline", messages: [{ body: message, ack, retry }] } as unknown as MessageBatch<PipelineMessage>, env);
    expect(ack).toHaveBeenCalledTimes(1); expect(retry).not.toHaveBeenCalled(); expect(counted.getCalls()).toBeLessThan(40);
    expect(first(db, "SELECT views,status FROM metric_snapshots")).toEqual({ views: 123, status: "captured" });
  });

  it("중복 Queue는 lease로 겹쳐 수집하지 않고 실패는 retry한다", async () => {
    const { env, provider, db } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    provider.mockImplementationOnce(async () => { await gate; return Response.json({ data: [] }); });
    const one = processSnapshotCollection({ snapshotId: "snap" }, env);
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    await processSnapshotCollection({ snapshotId: "snap" }, env);
    expect(provider).toHaveBeenCalledTimes(1); release(); await one;
    expect(first(db, "SELECT collection_token FROM metric_snapshots").collection_token).toBeNull();
  });

  it("최종 DB 쓰기 실패는 Queue에서 ack하지 않고 lease를 풀어 같은 메시지로 재시도한다", async () => {
    const { env, db } = await setup();
    db.exec("CREATE TRIGGER fail_snapshot BEFORE UPDATE OF status ON metric_snapshots WHEN NEW.status='captured' BEGIN SELECT RAISE(ABORT,'test'); END");
    const ack = vi.fn(), retry = vi.fn(); vi.spyOn(console, "error").mockImplementation(() => {});
    const batch = { queue: "avocado-pipeline", messages: [{ body: { type: "collect_snapshot", payload: { snapshotId: "snap" } }, ack, retry }] } as unknown as MessageBatch<PipelineMessage>;
    await worker.queue(batch, env);
    expect(ack).not.toHaveBeenCalled(); expect(retry).toHaveBeenCalledTimes(1);
    expect(first(db, "SELECT collection_token,status FROM metric_snapshots")).toEqual({ collection_token: null, status: "scheduled" });
    db.exec("DROP TRIGGER fail_snapshot");
    await worker.queue(batch, env);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(first(db, "SELECT views,status FROM metric_snapshots")).toEqual({ views: 123, status: "captured" });
  });

  it("늦은 옛 URL hook은 새 URL의 예약을 지우지 않는다", async () => {
    const { env, orm, db } = await setup();
    db.exec("UPDATE contents SET collection_revision=2,url='https://www.instagram.com/reel/NEW/'");
    await scheduleSnapshots(orm, env, "post", { reset: true, expectedRevision: 0 });
    expect(first(db, "SELECT id FROM metric_snapshots").id).toBe("snap");
  });

  it("내보내기 행 한도는 첫 조회 뒤 차단하고 CSV 열·숫자 셀 계약은 유지한다", async () => {
    const { orm, counted } = await setup(); counted.reset();
    await expect(performanceRows(orm, "w", {}, 0)).rejects.toMatchObject({ code: "export_too_many_rows" });
    expect(counted.getCalls()).toBe(1);
    const rows = await performanceRows(orm, "w", {});
    const cells = performanceCells(rows);
    expect(typeof cells[1]![cells[1]!.length - 1]).toBe("number");
    expect(performanceCsv(rows)).toContain("단축링크 클릭,리드 수");
    expect(performanceCsv(rows)).not.toContain("thumbnail");
  });
});

describe("영속 썸네일 원장과 파기 경합", () => {
  it("put 전에 원장을 남기고 정상 저장 후 부모 cascade 삭제도 유예 뒤 회수한다", async () => {
    const { db, env, orm, r2, content } = await setup();
    r2.beforePut = async () => {
      expect(db.prepare("SELECT key FROM content_thumbnail_objects").all()).toHaveLength(1);
      expect(first(db, "SELECT thumbnail_key FROM contents").thumbnail_key).toBeNull();
    };
    expect(await saveContentThumbnail(env, orm, "w", await content(), CDN)).toBe(true);
    expect(r2.objects.size).toBe(1);
    db.exec("DELETE FROM guides WHERE id='g'");
    expect(db.prepare("SELECT key FROM content_thumbnail_objects").all()).toHaveLength(1);
    await processThumbnailSweep({}, env); expect(r2.objects.size).toBe(1);
    vi.spyOn(Date, "now").mockReturnValue(NOW + THUMBNAIL_ORPHAN_GRACE_MS + 1);
    await processThumbnailSweep({}, env);
    expect(r2.objects.size).toBe(0);
    expect(first(db, "SELECT retired_at,deleted_at FROM content_thumbnail_objects")).toMatchObject({ retired_at: NOW + THUMBNAIL_ORPHAN_GRACE_MS + 1, deleted_at: NOW + THUMBNAIL_ORPHAN_GRACE_MS + 1 });
  });

  it("live 참조는 보존하고 softdelete된 키와 포인터는 유예 뒤 같은 원자 batch로 파기한다", async () => {
    const { db, env, orm, r2, content } = await setup();
    await saveContentThumbnail(env, orm, "w", await content(), CDN);
    vi.spyOn(Date, "now").mockReturnValue(NOW + THUMBNAIL_ORPHAN_GRACE_MS + 1);
    await processThumbnailSweep({}, env);
    expect(r2.objects.size).toBe(1); expect(first(db, "SELECT retired_at FROM content_thumbnail_objects").retired_at).toBeNull();
    db.prepare("UPDATE contents SET deleted_at=? WHERE id='post'").run(NOW + THUMBNAIL_ORPHAN_GRACE_MS);
    await processThumbnailSweep({}, env);
    expect(r2.objects.size).toBe(0);
    expect(first(db, "SELECT thumbnail_key,thumbnail_url,thumbnail_fetched_at FROM contents")).toEqual({ thumbnail_key: null, thumbnail_url: null, thumbnail_fetched_at: null });
  });

  it("put 완료 뒤 Worker가 종료된 상태도 sweep이 복구하며 완료 tombstone이 늦은 put을 다시 회수한다", async () => {
    const { db, env, r2 } = await setup();
    const key = "content-thumbnails/w/post/orphan.jpg";
    // put 이전 원장과 성공한 R2 쓰기만 남고 최종 CAS/catch가 실행되지 않은 상태.
    db.prepare("INSERT INTO content_thumbnail_objects(key,workspace_id,content_id,created_at) VALUES(?,'w','post',?)").run(key, NOW);
    r2.objects.set(key, { bytes: IMAGE, type: "image/jpeg" });
    vi.spyOn(Date, "now").mockReturnValue(NOW + THUMBNAIL_ORPHAN_GRACE_MS + 1);
    await processThumbnailSweep({}, env); expect(r2.objects.size).toBe(0);
    r2.objects.set(key, { bytes: IMAGE, type: "image/jpeg" });
    vi.spyOn(Date, "now").mockReturnValue(NOW + THUMBNAIL_ORPHAN_GRACE_MS + 60_000);
    await processThumbnailSweep({}, env);
    expect(r2.objects.size).toBe(0);
    expect(db.prepare("SELECT key FROM content_thumbnail_objects").all()).toHaveLength(1);
  });

  it("put 응답 손실·R2 삭제 실패는 원장에 남아 메시지가 없어져도 다음 sweep에서 복구한다", async () => {
    const { db, env, orm, r2, content, messages } = await setup();
    r2.losePutResponse = true; r2.failDelete = true;
    await expect(saveContentThumbnail(env, orm, "w", await content(), CDN)).rejects.toThrow("R2 put response lost");
    expect(r2.objects.size).toBe(1); expect(messages.some((message) => message.type === "cleanup_content_thumbnail")).toBe(true);
    expect(first(db, "SELECT retired_at,deleted_at FROM content_thumbnail_objects")).toEqual({ retired_at: NOW, deleted_at: null });
    r2.failDelete = false;
    await processThumbnailSweep({}, env);
    expect(r2.objects.size).toBe(0); expect(first(db, "SELECT deleted_at FROM content_thumbnail_objects").deleted_at).toBe(NOW);
  });

  it("cleanup이 먼저 key를 retired로 claim하면 늦은 writer의 최종 CAS는 그 키를 참조하지 못한다", async () => {
    const { db, env, orm, r2, content } = await setup();
    r2.beforePut = async () => {
      r2.beforePut = undefined;
      const key = String(first(db, "SELECT key FROM content_thumbnail_objects").key);
      await processThumbnailCleanup({ workspaceId: "w", contentId: "post", key }, env);
      expect(first(db, "SELECT retired_at FROM content_thumbnail_objects").retired_at).toBe(NOW);
    };
    expect(await saveContentThumbnail(env, orm, "w", await content(), CDN)).toBe(false);
    expect(first(db, "SELECT thumbnail_key FROM contents").thumbnail_key).toBeNull();
    expect(r2.objects.size).toBe(0);
  });

  it("100키 상한·공정 재검사와 별도 Queue의 D1/R2 호출 예산을 지킨다", async () => {
    const { db, env, r2, counted } = await setup();
    for (let n = 0; n < 101; n++) {
      const key = `content-thumbnails/w/post/orphan-${String(n).padStart(3, "0")}.jpg`;
      db.prepare("INSERT INTO content_thumbnail_objects(key,workspace_id,content_id,created_at) VALUES(?,'w','post',?)").run(key, NOW - THUMBNAIL_ORPHAN_GRACE_MS - 1);
      r2.objects.set(key, { bytes: IMAGE, type: "image/jpeg" });
    }
    const remove = vi.spyOn(r2, "delete"); counted.reset();
    const ack = vi.fn(), retry = vi.fn();
    await worker.queue({ queue: "avocado-pipeline", messages: [{ body: { type: "sweep_content_thumbnails", payload: {} }, ack, retry }] } as unknown as MessageBatch<PipelineMessage>, env);
    expect(ack).toHaveBeenCalledTimes(1); expect(retry).not.toHaveBeenCalled();
    expect(counted.getCalls()).toBeLessThan(10); expect(remove).toHaveBeenCalledTimes(1);
    expect(r2.objects.size).toBe(1); expect(db.prepare("SELECT key FROM content_thumbnail_objects WHERE retired_at IS NOT NULL").all()).toHaveLength(100);
    vi.spyOn(Date, "now").mockReturnValue(NOW + 1);
    await processThumbnailSweep({}, env);
    expect(r2.objects.size).toBe(0); expect(db.prepare("SELECT key FROM content_thumbnail_objects WHERE retired_at IS NOT NULL").all()).toHaveLength(101);
  });

  it("sweep의 R2 실패는 ack하지 않고 retired 원장을 보존해 같은 Queue 메시지로 재시도한다", async () => {
    const { db, env, r2 } = await setup();
    const key = "content-thumbnails/w/post/retry-orphan.jpg";
    db.prepare("INSERT INTO content_thumbnail_objects(key,workspace_id,content_id,created_at) VALUES(?,'w','post',?)").run(key, NOW - THUMBNAIL_ORPHAN_GRACE_MS - 1);
    r2.objects.set(key, { bytes: IMAGE, type: "image/jpeg" }); r2.failDelete = true;
    const ack = vi.fn(), retry = vi.fn(); vi.spyOn(console, "error").mockImplementation(() => {});
    const batch = { queue: "avocado-pipeline", messages: [{ body: { type: "sweep_content_thumbnails", payload: {} }, ack, retry }] } as unknown as MessageBatch<PipelineMessage>;
    await worker.queue(batch, env);
    expect(ack).not.toHaveBeenCalled(); expect(retry).toHaveBeenCalledTimes(1);
    expect(first(db, "SELECT retired_at,deleted_at FROM content_thumbnail_objects")).toEqual({ retired_at: NOW, deleted_at: null });
    r2.failDelete = false;
    await worker.queue(batch, env);
    expect(ack).toHaveBeenCalledTimes(1); expect(r2.objects.size).toBe(0);
    expect(first(db, "SELECT deleted_at FROM content_thumbnail_objects").deleted_at).toBe(NOW);
  });
});
