// F-48 24시간·3일·7일 스냅샷 스케줄러. 예약은 contents 등록 훅에서, 수집은 15분 cron 에서
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { contents, guides, igConnections, influencers, metricSnapshots } from "../db/schema";
import { afterApiError, delayInfo, MAIN_METRICS, METRICS, parsePostUrl, planSnapshots, type Metric, type MissingReason, type SnapshotPath } from "../../shared/performance";
import { decryptToken } from "./crypto";
import { discoverMedia, isFake, mediaById, mediaInsights, mediaMatches, tokenKey, type DiscoveredMedia, type IgFail } from "./instagram";
import { logEvent } from "./events";
import { newId, now } from "./ids";
import { z } from "zod";
import { COLLECTION_GRACE_MS, collectionAllowed, collectionContent } from "./content-collection";
import { saveContentThumbnail } from "./content-thumbnail";
import { mediaMetadata, mediaThumbnailUrl } from "./instagram";
import { definitiveIgDisconnect, igConnectionState, igConnectionUsable, igConnectionUsableSql, igGrantVerified } from "./ig-connection-state";
import { disconnectIgConnection } from "./ig-disconnect-mail";

type ContentRow = typeof contents.$inferSelect;
type LookupEvidence = { method: "recent_50" | "cached_id"; result: "found" | "not_in_recent_window" | "unavailable" | "error"; code?: number; subcode?: number };
type CaptureFailure = IgFail & { lookup?: LookupEvidence };
const lookupProps = (lookup?: LookupEvidence) => lookup ? { lookup_method: lookup.method, lookup_result: lookup.result, provider_code: Number.isSafeInteger(lookup.code) ? lookup.code : null, provider_subcode: Number.isSafeInteger(lookup.subcode) ? lookup.subcode : null } : {};
const stillCollectible = async (db: Db, content: ContentRow, workspaceId: string) =>
  (await db.all<{ ok: number }>(sql`SELECT 1 AS ok WHERE ${collectionAllowed(content, workspaceId)}`)).length > 0;

// 미연결 경로 조회용 토큰: 운영 계정(IG_SYSTEM_*, 페이스북 로그인 경로) 우선, 없으면 워크스페이스 브랜드 발송 계정
// [검증 필요] 인스타그램 로그인 토큰으로 business_discovery 가 되는지 (C5 는 페이스북 로그인 경로 기능)
async function discoveryAuth(db: Db, env: Env, workspaceId: string): Promise<{ token: string; igUserId: string; host: "fb" | "ig"; connection?: typeof igConnections.$inferSelect } | null> {
  if (isFake(env)) return { token: "fake", igUserId: "fake_sys", host: "fb" };
  if (env.IG_SYSTEM_TOKEN && env.IG_SYSTEM_USER_ID) return { token: env.IG_SYSTEM_TOKEN, igUserId: env.IG_SYSTEM_USER_ID, host: "fb" };
  const key = tokenKey(env);
  if (!key) return null;
  const c = await db
    .select()
    .from(igConnections)
    .where(and(eq(igConnections.workspaceId, workspaceId), eq(igConnections.target, "brand_sender")))
    .orderBy(desc(igConnections.connectedAt), desc(igConnections.createdAt), desc(igConnections.id))
    .get();
  if (!c?.igUserId) return null;
  const state = igConnectionState(c);
  if (!state.connected) {
    if (igGrantVerified(c) && (state.reason === "expired" || state.reason === "token_missing")) await disconnectIgConnection(env, db, c, state.reason);
    return null;
  }
  return { token: await decryptToken(key, c.tokenEnc!), igUserId: c.igUserId, host: "ig", connection: c };
}

// 인플루언서 본인 연결 (F-54). 만료·해제면 expired 로 알려 미연결 경로로 바꾼다
async function influencerConnection(db: Db, workspaceId: string, influencerId: string) {
  const c = await db
    .select()
    .from(igConnections)
    .where(and(eq(igConnections.workspaceId, workspaceId), eq(igConnections.influencerId, influencerId), eq(igConnections.target, "influencer")))
    .orderBy(desc(igConnections.connectedAt), desc(igConnections.createdAt), desc(igConnections.id))
    .get();
  if (!c?.connectedAt) return { state: "none" as const };
  if (!igConnectionUsable(c)) return { state: "unusable" as const, conn: c };
  return { state: "ok" as const, conn: c };
}

async function findMedia(db: Db, env: Env, workspaceId: string, content: ContentRow, username: string | null): Promise<{ media: DiscoveredMedia | null; lookup: LookupEvidence } | CaptureFailure> {
  const parsed = parsePostUrl(content.url);
  if (!parsed || (!username && !content.igMediaId)) return { ok: false, reason: "not_connected" };
  const auth = await discoveryAuth(db, env, workspaceId);
  if (!auth) return { ok: false, reason: "not_connected" };
  if (!(await stillCollectible(db, content, workspaceId))) return { ok: false, reason: "campaign_ended" };
  if (username) {
    const recent = await discoverMedia(env, auth, username, parsed.shortcode);
    if (!recent.ok) {
      if (auth.connection) {
        const reason = definitiveIgDisconnect(recent);
        if (reason) await disconnectIgConnection(env, db, auth.connection, reason);
      }
      return { ...recent, lookup: { method: "recent_50", result: "error", code: recent.code, subcode: recent.subcode } };
    }
    if (recent.data) return { media: recent.data, lookup: { method: "recent_50", result: "found" } };
  }
  if (!content.igMediaId) return { media: null, lookup: { method: "recent_50", result: "not_in_recent_window" } };
  // 목록은 완주 여부와 관계없이 삭제 증거가 아니다. 알려진 ID 한 건만 같은 권한·host로 재조회한다.
  if (!(await stillCollectible(db, content, workspaceId))) return { ok: false, reason: "content_changed" };
  if (auth.connection && !(await db.all(sql`SELECT 1 FROM ig_connections g WHERE g.id=${auth.connection.id} AND g.generation=${auth.connection.generation} AND ${igConnectionUsableSql("g")}`)).length) return { ok: false, reason: "not_connected" };
  const direct = await mediaById(env, auth, content.igMediaId, parsed.shortcode);
  if (auth.connection && !(await db.all(sql`SELECT 1 FROM ig_connections g WHERE g.id=${auth.connection.id} AND g.workspace_id=${workspaceId} AND g.generation=${auth.connection.generation} AND ${igConnectionUsableSql("g")}`)).length) return { ok: false, reason: "not_connected" };
  if (!direct.ok) {
    if (auth.connection) {
      const reason = definitiveIgDisconnect(direct);
      if (reason) await disconnectIgConnection(env, db, auth.connection, reason);
    }
    return { ...direct, reason: direct.reason === "not_supported" ? "private_or_unavailable" : direct.reason, lookup: { method: "cached_id", result: direct.reason === "private_or_unavailable" || direct.reason === "not_supported" ? "unavailable" : "error", code: direct.code, subcode: direct.subcode } };
  }
  return { media: direct.data, lookup: { method: "cached_id", result: "found" } };
}

// 등록 훅 (TASK-020 registerContent → onContentRegistered). 게시 시각을 모르면 미연결 조회로 읽고,
// 그래도 모르면 등록 시각을 기준으로 예약한다 [추론: 게시 직후 URL 을 붙여 넣는다고 본다]. 브랜드가 게시 시각을 고치면 다시 부른다
// reset: URL 이 새로 등록·교체된 경우. 이전 URL 기준 스냅샷을 지우고 새로 예약한다
export async function scheduleSnapshots(db: Db, env: Env, contentId: string, opts: { reset?: boolean; retry?: boolean; expectedRevision?: number } = {}): Promise<void> {
  const current = await collectionContent(db, contentId);
  if (!current || current.state.stoppedReason || (opts.expectedRevision !== undefined && current.content.collectionRevision !== opts.expectedRevision)) return;
  let content = current.content;
  const g = { ws: current.workspaceId };
  if (opts.reset) await db.delete(metricSnapshots).where(and(eq(metricSnapshots.contentId, contentId), collectionAllowed(content, g.ws)));

  if (content.postedAt === null) {
    const inf = await db.select({ handle: influencers.igHandle }).from(influencers).where(eq(influencers.id, content.influencerId)).get();
    const found = await findMedia(db, env, g.ws, content, inf?.handle ?? null);
    if ("media" in found && found.media) {
      const postedAt = Date.parse(found.media.timestamp);
      if (Number.isFinite(postedAt)) {
        const changed = await db.update(contents).set({ postedAt, postedAtSource: "api", igMediaId: found.media.id })
          .where(and(eq(contents.id, contentId), collectionAllowed(content, g.ws))).returning();
        if (!changed.length) return;
        content = changed[0]!;
      }
      await cacheThumbnail(db, env, g.ws, content, found.media);
    }
  }

  const base = content.postedAt ?? content.registeredAt;
  const existing = await db.select().from(metricSnapshots).where(eq(metricSnapshots.contentId, contentId));
  for (const p of planSnapshots(base, content.registeredAt)) {
    const prev = existing.find((e) => e.offsetH === p.offsetH);
    // 이미 수집했거나 결측으로 닫힌 시점(등록 늦음 제외)은 그대로 둔다
    if (prev && prev.status !== "scheduled" && !(prev.status === "missing" && prev.missing._ === "registered_late") && !(opts.retry && prev.status !== "captured")) continue;
    const values = {
      scheduledAt: p.scheduledAt,
      status: p.status,
      missing: p.reason ? { _: p.reason } : {},
      attempts: 0,
      collectionToken: null,
      collectionStartedAt: null,
    };
    const written = prev ? (await db.update(metricSnapshots).set(values).where(and(eq(metricSnapshots.id, prev.id), collectionAllowed(content, g.ws))).returning({ id: metricSnapshots.id })).length
      : (await db.run(sql`INSERT INTO metric_snapshots (id,content_id,offset_h,scheduled_at,status,missing,attempts)
        SELECT ${newId()},${contentId},${p.offsetH},${p.scheduledAt},${p.status},${JSON.stringify(values.missing)},0
        WHERE ${collectionAllowed(content, g.ws)} ON CONFLICT(content_id,offset_h) DO NOTHING`)).meta.changes;
    if (!written) return;
    if (prev) continue;
    if (p.status === "scheduled") await logEvent(db, g.ws, "snapshot_scheduled", { offset_h: p.offsetH, content_id: contentId });
    else await logEvent(db, g.ws, "snapshot_missing", { offset_h: p.offsetH, reason: p.reason, content_id: contentId });
  }
}

type Capture = { path: SnapshotPath; values: Partial<Record<Metric, number>>; missing: Partial<Record<Metric | "_", MissingReason>>; lookup?: LookupEvidence };

async function cacheThumbnail(db: Db, env: Env, workspaceId: string, content: ContentRow, media: DiscoveredMedia) {
  const url = mediaThumbnailUrl(media);
  if (!url) return;
  try { await saveContentThumbnail(env, db, workspaceId, content, url); }
  catch (error) {
    if (!(error instanceof Error) || (!error.message.startsWith("thumbnail_") && error.name !== "AbortError")) throw error;
    console.error("[content_thumbnail_failed]", JSON.stringify({ reason: "thumbnail_copy_failed" }));
  }
}

// 한 시점 조회. 실패 사유는 Capture.missing 또는 IgFail 로 돌려준다
async function capture(db: Db, env: Env, workspaceId: string, content: ContentRow): Promise<Capture | CaptureFailure> {
  const conn = await influencerConnection(db, workspaceId, content.influencerId);
  if (conn.state === "unusable" && igGrantVerified(conn.conn)) {
    const reason = igConnectionState(conn.conn).reason;
    if (reason === "expired" || reason === "token_missing") await disconnectIgConnection(env, db, conn.conn, reason);
  }
  const key = tokenKey(env);
  if (conn.state === "ok" && key && content.igMediaId) {
    const token = await decryptToken(key, conn.conn.tokenEnc!);
    if (!(await stillCollectible(db, content, workspaceId))) return { ok: false, reason: "campaign_ended" };
    const r = await mediaInsights(env, token, content.igMediaId);
    if (r.ok) {
      if (await stillCollectible(db, content, workspaceId)) {
        const media = await mediaMetadata(env, token, content.igMediaId);
        if (media.ok) {
          const shortcode = parsePostUrl(content.url)?.shortcode;
          if (!shortcode || !mediaMatches(media.data, shortcode, content.igMediaId)) return { ok: false, reason: "invalid_response", lookup: { method: "cached_id", result: "error" } };
          await cacheThumbnail(db, env, workspaceId, content, media.data);
        }
        else {
          const reason = definitiveIgDisconnect(media);
          if (reason) await disconnectIgConnection(env, db, conn.conn, reason);
        }
      }
      const missing: Capture["missing"] = {};
      for (const m of METRICS) if (r.data[m] === undefined) missing[m] = "not_supported";
      return { path: "connected", values: r.data, missing, lookup: { method: "cached_id", result: "found" } };
    }
    const reason = definitiveIgDisconnect(r);
    if (reason) await disconnectIgConnection(env, db, conn.conn, reason);
    if (r.reason !== "token_expired") return { ...r, lookup: { method: "cached_id", result: r.reason === "private_or_unavailable" || r.reason === "not_supported" ? "unavailable" : "error", code: r.code, subcode: r.subcode } };
    // 토큰 만료 → 이번 시점부터 미연결 경로
  }
  const noConn: MissingReason = conn.state === "none" || (conn.state === "unusable" && !igGrantVerified(conn.conn)) ? "not_connected" : "token_expired";
  const inf = await db.select({ handle: influencers.igHandle }).from(influencers).where(eq(influencers.id, content.influencerId)).get();
  const found = await findMedia(db, env, workspaceId, content, inf?.handle ?? null);
  if (!("media" in found)) return found;
  if (!found.media) {
    return { ok: false, reason: "private_or_unavailable", lookup: found.lookup };
  }
  const m = found.media;
  if (!content.igMediaId) await db.update(contents).set({ igMediaId: m.id }).where(and(eq(contents.id, content.id), collectionAllowed(content, workspaceId)));
  await cacheThumbnail(db, env, workspaceId, content, m);
  const values: Capture["values"] = {};
  const missing: Capture["missing"] = { saved: noConn, shares: noConn, reach: noConn, reposts: noConn };
  if (m.view_count !== undefined) values.views = m.view_count;
  else missing.views = "not_supported";
  if (m.like_count !== undefined) values.likes = m.like_count;
  else missing.likes = "hidden_by_owner";
  if (m.comments_count !== undefined) values.comments = m.comments_count;
  else missing.comments = "not_supported";
  return { path: "discovery", values, missing, lookup: found.lookup };
}

const allMissing = (reason: MissingReason) => Object.fromEntries(MAIN_METRICS.map((m) => [m, reason])) as Capture["missing"];

const SNAPSHOT_LEASE_MS = 5 * 60 * 1000;
const snapshotJob = z.object({ snapshotId: z.string().min(1).max(100) });

// Cron은 ID만 Queue에 넣는다. PIPELINE(max_batch_size=1)이 스냅샷마다 별도 호출 예산을 제공한다.
export async function runDueSnapshots(env: Env): Promise<{ processed: number }> {
  const t = now();
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE metric_snapshots SET status='cancelled', collection_token=NULL, collection_started_at=NULL,
      missing=json_object('_',CASE
        WHEN NOT EXISTS(SELECT 1 FROM contents c JOIN guides g ON g.id=c.guide_id WHERE c.id=metric_snapshots.content_id AND c.deleted_at IS NULL) THEN 'deleted'
        WHEN NOT EXISTS(SELECT 1 FROM contents c JOIN guides g ON g.id=c.guide_id JOIN campaigns p ON p.id=g.campaign_id AND p.workspace_id=g.workspace_id WHERE c.id=metric_snapshots.content_id) THEN 'campaign_missing'
        WHEN EXISTS(SELECT 1 FROM contents c JOIN guides g ON g.id=c.guide_id JOIN campaigns p ON p.id=g.campaign_id AND p.workspace_id=g.workspace_id WHERE c.id=metric_snapshots.content_id AND p.ends_at IS NULL) THEN 'campaign_end_unknown'
        ELSE 'campaign_ended' END)
      WHERE status='scheduled' AND NOT EXISTS(SELECT 1 FROM contents c JOIN guides g ON g.id=c.guide_id
        JOIN campaigns p ON p.id=g.campaign_id AND p.workspace_id=g.workspace_id WHERE c.id=metric_snapshots.content_id AND c.deleted_at IS NULL
        AND ((p.ends_at IS NULL AND p.status='active') OR (p.ends_at IS NOT NULL AND p.ends_at+?>?)))`)
      .bind(COLLECTION_GRACE_MS, t),
    env.DB.prepare(`SELECT ms.id FROM metric_snapshots ms JOIN contents c ON c.id=ms.content_id
    JOIN guides g ON g.id=c.guide_id JOIN campaigns p ON p.id=g.campaign_id AND p.workspace_id=g.workspace_id
    WHERE ms.status='scheduled' AND ms.scheduled_at<=? AND c.deleted_at IS NULL
    AND (ms.collection_token IS NULL OR ms.collection_started_at<?)
    AND ((p.ends_at IS NULL AND p.status='active') OR (p.ends_at IS NOT NULL AND p.ends_at+?>?))
    ORDER BY ms.scheduled_at,ms.id LIMIT 50`).bind(t, t - SNAPSHOT_LEASE_MS, COLLECTION_GRACE_MS, t),
  ]);
  const due = result[1]!.results as { id: string }[];
  if (due.length) await env.PIPELINE.sendBatch(due.map((item) => ({ body: { type: "collect_snapshot", payload: { snapshotId: item.id } } })));
  return { processed: due.length };
}

type DueItem = { snap: typeof metricSnapshots.$inferSelect; content: ContentRow; ws: string };

export async function processSnapshotCollection(raw: unknown, env: Env): Promise<void> {
  const { snapshotId } = snapshotJob.parse(raw);
  const db = getDb(env.DB);
  const snap = await db.select().from(metricSnapshots).where(eq(metricSnapshots.id, snapshotId)).get();
  if (!snap || snap.status !== "scheduled" || snap.scheduledAt > now()) return;
  const current = await collectionContent(db, snap.contentId);
  if (!current || current.state.stoppedReason) {
    await db.update(metricSnapshots).set({ status: "cancelled", missing: { _: current?.state.stoppedReason ?? "deleted" }, collectionToken: null, collectionStartedAt: null }).where(and(eq(metricSnapshots.id, snap.id), eq(metricSnapshots.status, "scheduled")));
    return;
  }
  const token = newId();
  const claimed = await db.update(metricSnapshots).set({ collectionToken: token, collectionStartedAt: now() })
    .where(and(eq(metricSnapshots.id, snap.id), eq(metricSnapshots.status, "scheduled"),
      sql`(${metricSnapshots.collectionToken} IS NULL OR ${metricSnapshots.collectionStartedAt}<${now() - SNAPSHOT_LEASE_MS})`, collectionAllowed(current.content, current.workspaceId))).returning({ id: metricSnapshots.id });
  if (!claimed.length) return;
  try { await collectSnapshot(db, env, { snap, content: current.content, ws: current.workspaceId }, token); }
  catch (error) {
    await db.update(metricSnapshots).set({ collectionToken: null, collectionStartedAt: null }).where(and(eq(metricSnapshots.id, snap.id), eq(metricSnapshots.collectionToken, token)));
    throw error;
  }
}

async function commitSnapshot(db: Db, item: DueItem, token: string, values: Partial<typeof metricSnapshots.$inferInsert>): Promise<boolean> {
  const changed = await db.update(metricSnapshots).set({ ...values, collectionToken: null, collectionStartedAt: null })
    .where(and(eq(metricSnapshots.id, item.snap.id), eq(metricSnapshots.collectionToken, token), collectionAllowed(item.content, item.ws))).returning({ id: metricSnapshots.id });
  if (changed.length) return true;
  const current = await collectionContent(db, item.content.id);
  const reason = !current ? "deleted" : current.state.stoppedReason ?? (current.content.collectionRevision !== item.content.collectionRevision ? "content_changed" : "deleted");
  await db.update(metricSnapshots).set({ status: "cancelled", missing: { _: reason }, collectionToken: null, collectionStartedAt: null })
    .where(and(eq(metricSnapshots.id, item.snap.id), eq(metricSnapshots.collectionToken, token)));
  return false;
}

// 스냅샷 한 건 수집. 값이 하나라도 있으면 captured, API 오류는 재시도, 그 밖은 missing (게시물 삭제면 남은 예약 취소)
async function collectSnapshot(db: Db, env: Env, item: DueItem, token: string) {
  const { snap, content, ws } = item;
  const attempts = snap.attempts + 1;
  const r = content.deletedAt ? ({ ok: false, reason: "deleted" } as CaptureFailure) : await capture(db, env, ws, content);
  const capturedAt = now();
  const { delayed, delayMin } = delayInfo(snap.scheduledAt, capturedAt);
  if ("path" in r) {
    const hasValue = MAIN_METRICS.some((m) => r.values[m] !== undefined);
    if (!(await commitSnapshot(db, item, token, { ...r.values, path: r.path, missing: r.missing, capturedAt, delayed, attempts, status: hasValue ? "captured" : "missing" }))) return;
    await logEvent(db, ws, hasValue ? "snapshot_captured" : "snapshot_missing", { offset_h: snap.offsetH, path: r.path, delay_min: delayMin, content_id: content.id, ...lookupProps(r.lookup) });
    return;
  }
  if (r.reason === "api_error" && afterApiError(attempts) === "retry") {
    if (await commitSnapshot(db, item, token, { attempts })) await logEvent(db, ws, "snapshot_lookup_retry", { offset_h: snap.offsetH, content_id: content.id, attempts, ...lookupProps(r.lookup) });
    return;
  }
  const reason: MissingReason = r.reason === "not_configured" ? "not_connected"
    : ["grant_unverified", "invalid_response", "personal_account"].includes(r.reason) ? "api_error" : r.reason as MissingReason;
  if (!(await commitSnapshot(db, item, token, { missing: allMissing(reason), capturedAt, delayed, attempts, status: "missing" }))) return;
  await logEvent(db, ws, "snapshot_missing", { offset_h: snap.offsetH, reason, content_id: content.id, ...lookupProps(r.lookup) });
  // 조회 오류만으로 물리 삭제를 확정할 수 없다. 다른 시점의 예약·과거 수치·메일은 건드리지 않는다.
}
