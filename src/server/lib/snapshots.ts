// F-48 24시간·3일·7일 스냅샷 스케줄러. 예약은 contents 등록 훅에서, 수집은 15분 cron 에서
import { and, asc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { contents, guides, igConnections, influencers, metricSnapshots } from "../db/schema";
import { afterApiError, delayInfo, MAIN_METRICS, METRICS, parsePostUrl, planSnapshots, type Metric, type MissingReason, type SnapshotPath } from "../../shared/performance";
import { decryptToken } from "./crypto";
import { discoverMedia, isFake, mediaInsights, tokenKey, type DiscoveredMedia, type IgFail } from "./instagram";
import { logEvent } from "./events";
import { sendEmail } from "./email";
import { memberEmails } from "./members";
import { newId, now } from "./ids";

type ContentRow = typeof contents.$inferSelect;

async function workspaceOfGuide(db: Db, guideId: string) {
  return (await db.select({ ws: guides.workspaceId, name: guides.name }).from(guides).where(eq(guides.id, guideId)).get()) ?? null;
}

// 미연결 경로 조회용 토큰: 운영 계정(IG_SYSTEM_*, 페이스북 로그인 경로) 우선, 없으면 워크스페이스 브랜드 발송 계정
// [검증 필요] 인스타그램 로그인 토큰으로 business_discovery 가 되는지 (C5 는 페이스북 로그인 경로 기능)
async function discoveryAuth(db: Db, env: Env, workspaceId: string): Promise<{ token: string; igUserId: string; host: "fb" | "ig" } | null> {
  if (isFake(env)) return { token: "fake", igUserId: "fake_sys", host: "fb" };
  if (env.IG_SYSTEM_TOKEN && env.IG_SYSTEM_USER_ID) return { token: env.IG_SYSTEM_TOKEN, igUserId: env.IG_SYSTEM_USER_ID, host: "fb" };
  const key = tokenKey(env);
  if (!key) return null;
  const c = await db
    .select()
    .from(igConnections)
    .where(and(eq(igConnections.workspaceId, workspaceId), eq(igConnections.target, "brand_sender"), isNull(igConnections.revokedAt), gt(igConnections.expiresAt, now())))
    .get();
  if (!c?.tokenEnc || !c.igUserId) return null;
  return { token: await decryptToken(key, c.tokenEnc), igUserId: c.igUserId, host: "ig" };
}

// 인플루언서 본인 연결 (F-54). 만료·해제면 expired 로 알려 미연결 경로로 바꾼다
async function influencerConnection(db: Db, workspaceId: string, influencerId: string) {
  const c = await db
    .select()
    .from(igConnections)
    .where(and(eq(igConnections.workspaceId, workspaceId), eq(igConnections.influencerId, influencerId), eq(igConnections.target, "influencer")))
    .orderBy(sql`${igConnections.connectedAt} DESC`)
    .get();
  if (!c?.connectedAt) return { state: "none" as const };
  if (c.revokedAt || !c.tokenEnc || (c.expiresAt ?? 0) < now()) return { state: "expired" as const };
  return { state: "ok" as const, conn: c };
}

async function findMedia(db: Db, env: Env, workspaceId: string, content: ContentRow, username: string | null): Promise<{ media: DiscoveredMedia | null } | IgFail> {
  const parsed = parsePostUrl(content.url);
  if (!parsed || !username) return { ok: false, reason: "not_connected", message: "게시물 URL 또는 인스타그램 계정명 없음" };
  const auth = await discoveryAuth(db, env, workspaceId);
  if (!auth) return { ok: false, reason: "not_connected" };
  const r = await discoverMedia(env, auth, username, parsed.shortcode);
  return r.ok ? { media: r.data } : r;
}

// 등록 훅 (TASK-020 registerContent → onContentRegistered). 게시 시각을 모르면 미연결 조회로 읽고,
// 그래도 모르면 등록 시각을 기준으로 예약한다 [추론: 게시 직후 URL 을 붙여 넣는다고 본다]. 브랜드가 게시 시각을 고치면 다시 부른다
// reset: URL 이 새로 등록·교체된 경우. 이전 URL 기준 스냅샷을 지우고 새로 예약한다
export async function scheduleSnapshots(db: Db, env: Env, contentId: string, opts: { reset?: boolean } = {}): Promise<void> {
  if (opts.reset) await db.delete(metricSnapshots).where(eq(metricSnapshots.contentId, contentId));
  let content = await db.select().from(contents).where(eq(contents.id, contentId)).get();
  if (!content || content.deletedAt) return;
  const g = await workspaceOfGuide(db, content.guideId);
  if (!g) return;

  if (content.postedAt === null) {
    const inf = await db.select({ handle: influencers.igHandle }).from(influencers).where(eq(influencers.id, content.influencerId)).get();
    const found = await findMedia(db, env, g.ws, content, inf?.handle ?? null);
    if ("media" in found && found.media) {
      await db.update(contents).set({ postedAt: Date.parse(found.media.timestamp), postedAtSource: "api", igMediaId: found.media.id }).where(eq(contents.id, contentId));
      content = (await db.select().from(contents).where(eq(contents.id, contentId)).get())!;
    }
  }

  const base = content.postedAt ?? content.registeredAt;
  const existing = await db.select().from(metricSnapshots).where(eq(metricSnapshots.contentId, contentId));
  for (const p of planSnapshots(base, content.registeredAt)) {
    const prev = existing.find((e) => e.offsetH === p.offsetH);
    // 이미 수집했거나 결측으로 닫힌 시점(등록 늦음 제외)은 그대로 둔다
    if (prev && prev.status !== "scheduled" && !(prev.status === "missing" && prev.missing._ === "registered_late")) continue;
    const values = {
      scheduledAt: p.scheduledAt,
      status: p.status,
      missing: p.reason ? { _: p.reason } : {},
      attempts: 0,
    };
    if (prev) await db.update(metricSnapshots).set(values).where(eq(metricSnapshots.id, prev.id));
    else await db.insert(metricSnapshots).values({ id: newId(), contentId, offsetH: p.offsetH, ...values });
    if (prev) continue;
    if (p.status === "scheduled") await logEvent(db, g.ws, "snapshot_scheduled", { offset_h: p.offsetH, content_id: contentId });
    else await logEvent(db, g.ws, "snapshot_missing", { offset_h: p.offsetH, reason: p.reason, content_id: contentId });
  }
}

type Capture = { path: SnapshotPath; values: Partial<Record<Metric, number>>; missing: Partial<Record<Metric | "_", MissingReason>> };

// 한 시점 조회. 실패 사유는 Capture.missing 또는 IgFail 로 돌려준다
async function capture(db: Db, env: Env, workspaceId: string, content: ContentRow): Promise<Capture | IgFail> {
  const conn = await influencerConnection(db, workspaceId, content.influencerId);
  const key = tokenKey(env);
  if (conn.state === "ok" && key && content.igMediaId) {
    const token = await decryptToken(key, conn.conn.tokenEnc!);
    const r = await mediaInsights(env, token, content.igMediaId);
    if (r.ok) {
      const missing: Capture["missing"] = {};
      for (const m of METRICS) if (r.data[m] === undefined) missing[m] = "not_supported";
      return { path: "connected", values: r.data, missing };
    }
    if (r.reason !== "token_expired") return r;
    // 토큰 만료 → 이번 시점부터 미연결 경로
  }
  const noConn: MissingReason = conn.state === "none" ? "not_connected" : "token_expired";
  const inf = await db.select({ handle: influencers.igHandle }).from(influencers).where(eq(influencers.id, content.influencerId)).get();
  const found = await findMedia(db, env, workspaceId, content, inf?.handle ?? null);
  if (!("media" in found)) return found;
  if (!found.media) {
    // 전에 찾았던 게시물이 목록에서 사라졌으면 삭제로 본다 [추론]
    return { ok: false, reason: content.igMediaId ? "deleted" : "private_or_unavailable" };
  }
  const m = found.media;
  if (!content.igMediaId) await db.update(contents).set({ igMediaId: m.id }).where(eq(contents.id, content.id));
  const values: Capture["values"] = {};
  const missing: Capture["missing"] = { saved: noConn, shares: noConn, reach: noConn, reposts: noConn };
  if (m.view_count !== undefined) values.views = m.view_count;
  else missing.views = "not_supported";
  if (m.like_count !== undefined) values.likes = m.like_count;
  else missing.likes = "hidden_by_owner";
  if (m.comments_count !== undefined) values.comments = m.comments_count;
  else missing.comments = "not_supported";
  return { path: "discovery", values, missing };
}

async function notifyDeleted(db: Db, env: Env, workspaceId: string, content: ContentRow) {
  const owners = await memberEmails(db, workspaceId, ["owner", "editor"]);
  const link = `${env.APP_URL}/dashboard/guides/${content.guideId}`;
  for (const o of owners) {
    await sendEmail(env, {
      to: o.email,
      subject: "게시물이 삭제된 것 같아요",
      text: `성과 수집 중 게시물을 찾을 수 없었습니다. 남은 스냅샷은 취소했습니다.\n게시물: ${content.url}\n가이드: ${link}`,
      html: `<p>성과 수집 중 게시물을 찾을 수 없었습니다. 남은 스냅샷은 취소했습니다.</p><p>게시물: <a href="${content.url}">${content.url}</a></p><p><a href="${link}">가이드 열기</a></p>`,
    });
  }
}

const allMissing = (reason: MissingReason) => Object.fromEntries(MAIN_METRICS.map((m) => [m, reason])) as Capture["missing"];

// cron: 예정 시각이 지난 scheduled 스냅샷을 수집한다
// ponytail: 한 번에 50건. 게시물이 많아지면 Queue 로 나눠 보낸다
export async function runDueSnapshots(env: Env): Promise<{ processed: number }> {
  const db = getDb(env.DB);
  const t = now();
  const due = await db
    .select({ snap: metricSnapshots, content: contents, ws: guides.workspaceId })
    .from(metricSnapshots)
    .innerJoin(contents, eq(contents.id, metricSnapshots.contentId))
    .innerJoin(guides, eq(guides.id, contents.guideId))
    .where(and(eq(metricSnapshots.status, "scheduled"), lte(metricSnapshots.scheduledAt, t)))
    .orderBy(asc(metricSnapshots.scheduledAt))
    .limit(50);

  for (const item of due) await collectSnapshot(db, env, item);
  return { processed: due.length };
}

type DueItem = { snap: typeof metricSnapshots.$inferSelect; content: ContentRow; ws: string };

// 스냅샷 한 건 수집. 값이 하나라도 있으면 captured, API 오류는 재시도, 그 밖은 missing (게시물 삭제면 남은 예약 취소)
async function collectSnapshot(db: Db, env: Env, { snap, content, ws }: DueItem) {
  const attempts = snap.attempts + 1;
  const r = content.deletedAt ? ({ ok: false, reason: "deleted" } as IgFail) : await capture(db, env, ws, content);
  const capturedAt = now();
  const { delayed, delayMin } = delayInfo(snap.scheduledAt, capturedAt);
  if ("path" in r) {
    const hasValue = MAIN_METRICS.some((m) => r.values[m] !== undefined);
    await db
      .update(metricSnapshots)
      .set({ ...r.values, path: r.path, missing: r.missing, capturedAt, delayed, attempts, status: hasValue ? "captured" : "missing" })
      .where(eq(metricSnapshots.id, snap.id));
    await logEvent(db, ws, hasValue ? "snapshot_captured" : "snapshot_missing", { offset_h: snap.offsetH, path: r.path, delay_min: delayMin, content_id: content.id });
    return;
  }
  if (r.reason === "api_error" && afterApiError(attempts) === "retry") {
    await db.update(metricSnapshots).set({ attempts }).where(eq(metricSnapshots.id, snap.id));
    return;
  }
  const reason: MissingReason = r.reason === "not_configured" ? "not_connected" : r.reason;
  await db.update(metricSnapshots).set({ missing: allMissing(reason), capturedAt, delayed, attempts, status: "missing" }).where(eq(metricSnapshots.id, snap.id));
  await logEvent(db, ws, "snapshot_missing", { offset_h: snap.offsetH, reason, content_id: content.id });
  if (reason !== "deleted") return;
  await db
    .update(metricSnapshots)
    .set({ status: "cancelled", missing: allMissing("deleted") })
    .where(and(eq(metricSnapshots.contentId, content.id), eq(metricSnapshots.status, "scheduled")));
  await notifyDeleted(db, env, ws, content);
}
