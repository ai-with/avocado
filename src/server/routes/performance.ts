import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AppEnv } from "../types";
import type { Db } from "../db";
import { contents, guides, igConnections, influencers, metricSnapshots, shortLinks } from "../db/schema";
import { ApiError, parse } from "../lib/errors";
import { logEvent } from "../lib/events";
import { csvResponse } from "../lib/http";
import { scheduleSnapshots } from "../lib/snapshots";
import { editorsOnly, workspaceCtx } from "../middleware/auth";
import { statsByLink } from "../lib/link-stats";
import { toCsv } from "../../shared/csv";
import { MAIN_METRICS, OFFSET_LABELS, SNAPSHOT_OFFSETS, METRIC_LABELS, type MissingReason, type OffsetH } from "../../shared/performance";
import type { ContentFormat } from "../../shared/review";

type Snap = typeof metricSnapshots.$inferSelect;
export type PerfRow = {
  contentId: string;
  guideId: string;
  guideName: string;
  influencerId: string;
  influencerName: string;
  igHandle: string | null;
  url: string;
  format: ContentFormat;
  postedAt: number | null;
  postedAtSource: "api" | "manual" | null;
  registeredAt: number;
  connected: boolean;
  snapshots: Partial<Record<OffsetH, Pick<Snap, "status" | "scheduledAt" | "capturedAt" | "path" | "views" | "likes" | "saved" | "shares" | "comments" | "missing" | "delayed">>>;
  clicks: number;
  leads: number;
};

const filterSchema = z.object({ guideId: z.string().optional(), influencerId: z.string().optional(), format: z.string().optional() });

type Filter = z.infer<typeof filterSchema>;
type Totals = Map<string, { clicks: number; leads: number }>;
// D1 바인딩 변수 한도(100) 때문에 나눠 읽는다
const IN_CHUNK = 90;
const pairKey = (guideId: string | null, influencerId: string | null) => `${guideId}|${influencerId}`;

function contentRows(db: Db, workspaceId: string, f: Filter) {
  return db
    .select({ c: contents, guideName: guides.name, influencerName: influencers.displayName, igHandle: influencers.igHandle })
    .from(contents)
    .innerJoin(guides, eq(guides.id, contents.guideId))
    .innerJoin(influencers, eq(influencers.id, contents.influencerId))
    .where(
      and(
        eq(guides.workspaceId, workspaceId),
        isNull(contents.deletedAt),
        f.guideId ? eq(contents.guideId, f.guideId) : undefined,
        f.influencerId ? eq(contents.influencerId, f.influencerId) : undefined,
        f.format ? eq(contents.format, f.format as ContentFormat) : undefined,
      ),
    )
    .orderBy(asc(contents.registeredAt));
}

async function snapshotsOf(db: Db, ids: string[]) {
  const snaps: Snap[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) snaps.push(...(await db.select().from(metricSnapshots).where(inArray(metricSnapshots.contentId, ids.slice(i, i + IN_CHUNK)))));
  return snaps;
}

// 단축링크 클릭·리드는 같은 가이드 × 인플루언서 링크 합계 (F-50, F-52)
async function linkTotals(db: Db, workspaceId: string): Promise<Totals> {
  const stats = await statsByLink(db, workspaceId);
  const links = await db.select({ id: shortLinks.id, guideId: shortLinks.guideId, influencerId: shortLinks.influencerId }).from(shortLinks).where(eq(shortLinks.workspaceId, workspaceId));
  const totals: Totals = new Map();
  for (const l of links) {
    const key = pairKey(l.guideId, l.influencerId);
    const acc = totals.get(key) ?? { clicks: 0, leads: 0 };
    acc.clicks += stats.get(l.id)?.clicks ?? 0;
    totals.set(key, acc);
  }
  // 리드는 사람 기준으로 한 번만 (REPORT-019 집계 기준)
  const leadRows = await db.all<{ guide_id: string; influencer_id: string; n: number }>(
    sql`SELECT s.guide_id, s.influencer_id, count(DISTINCT s.lead_id) AS n FROM lead_sources s JOIN leads l ON l.id = s.lead_id WHERE l.workspace_id = ${workspaceId} AND l.deleted_at IS NULL AND s.influencer_id IS NOT NULL GROUP BY s.guide_id, s.influencer_id`,
  );
  for (const r of leadRows) {
    const key = pairKey(r.guide_id, r.influencer_id);
    totals.set(key, { clicks: totals.get(key)?.clicks ?? 0, leads: r.n });
  }
  return totals;
}

async function connectedInfluencers(db: Db, workspaceId: string) {
  const conns = await db
    .select({ influencerId: igConnections.influencerId })
    .from(igConnections)
    .where(and(eq(igConnections.workspaceId, workspaceId), eq(igConnections.target, "influencer"), isNull(igConnections.revokedAt), sql`${igConnections.connectedAt} IS NOT NULL`));
  return new Set(conns.map((c) => c.influencerId));
}

function snapshotCells(mine: Snap[]) {
  const snapshots: PerfRow["snapshots"] = {};
  for (const s of mine) {
    snapshots[s.offsetH] = { status: s.status, scheduledAt: s.scheduledAt, capturedAt: s.capturedAt, path: s.path, views: s.views, likes: s.likes, saved: s.saved, shares: s.shares, comments: s.comments, missing: s.missing, delayed: s.delayed };
  }
  return snapshots;
}

export async function performanceRows(db: Db, workspaceId: string, f: Filter): Promise<PerfRow[]> {
  const rows = await contentRows(db, workspaceId, f);
  if (rows.length === 0) return [];
  const snaps = await snapshotsOf(db, rows.map((r) => r.c.id));
  const totals = await linkTotals(db, workspaceId);
  const connected = await connectedInfluencers(db, workspaceId);
  return rows.map(({ c, guideName, influencerName, igHandle }) => {
    const sum = totals.get(pairKey(c.guideId, c.influencerId));
    return {
      contentId: c.id,
      guideId: c.guideId,
      guideName,
      influencerId: c.influencerId,
      influencerName,
      igHandle,
      url: c.url,
      format: c.format,
      postedAt: c.postedAt,
      postedAtSource: c.postedAtSource,
      registeredAt: c.registeredAt,
      connected: connected.has(c.influencerId),
      snapshots: snapshotCells(snaps.filter((s) => s.contentId === c.id)),
      clicks: sum?.clicks ?? 0,
      leads: sum?.leads ?? 0,
    };
  });
}

// 빈칸이면 지표별 사유, 없으면 시점 전체 사유(_). 아직 예약 상태면 빈 문자열
function cellReason(s: PerfRow["snapshots"][OffsetH], metric: string): MissingReason | "" {
  if (!s || s.status === "scheduled") return "";
  return s.missing[metric] ?? s.missing._ ?? "";
}

const iso = (t: number | null) => (t ? new Date(t).toISOString() : "");

export function performanceCsv(rows: PerfRow[]): string {
  const head = ["가이드", "인플루언서", "인스타그램", "형식", "게시물 URL", "게시 시각", "게시 시각 출처"];
  for (const o of SNAPSHOT_OFFSETS) {
    head.push(`${OFFSET_LABELS[o]} 조회 시각`, `${OFFSET_LABELS[o]} 수집 경로`);
    for (const m of MAIN_METRICS) head.push(`${OFFSET_LABELS[o]} ${METRIC_LABELS[m]}`, `${OFFSET_LABELS[o]} ${METRIC_LABELS[m]} 사유`);
  }
  head.push("단축링크 클릭", "리드 수");
  const body = rows.map((r) => {
    const line: (string | number)[] = [r.guideName, r.influencerName, r.igHandle ? `@${r.igHandle}` : "", r.format, r.url, iso(r.postedAt), r.postedAtSource ?? "registered_at"];
    for (const o of SNAPSHOT_OFFSETS) {
      const s = r.snapshots[o];
      line.push(iso(s?.capturedAt ?? null), s?.path ?? "");
      for (const m of MAIN_METRICS) line.push(s?.[m] ?? "", cellReason(s, m));
    }
    line.push(r.clicks, r.leads);
    return line.map(String);
  });
  return toCsv([head, ...body]);
}

export const performanceRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const f = parse(filterSchema, c.req.query());
    const rows = await performanceRows(c.var.db, workspace.id, f);
    if (!f.guideId) await logEvent(c.var.db, workspace.id, "performance_table_viewed", {});
    const gl = await c.var.db.select({ id: guides.id, name: guides.name }).from(guides).where(eq(guides.workspaceId, workspace.id)).orderBy(asc(guides.createdAt));
    const il = await c.var.db.select({ id: influencers.id, name: influencers.displayName }).from(influencers).where(eq(influencers.workspaceId, workspace.id)).orderBy(asc(influencers.displayName));
    return c.json({ rows, filters: { guides: gl, influencers: il } });
  })
  .get("/export", async (c) => {
    const { workspace } = workspaceCtx(c);
    const rows = await performanceRows(c.var.db, workspace.id, parse(filterSchema, c.req.query()));
    await logEvent(c.var.db, workspace.id, "performance_exported", { format: "csv" });
    return csvResponse(performanceCsv(rows), "performance.csv");
  })
  // 게시 시각을 못 읽었을 때 브랜드가 직접 입력 (F-48 '수동' 표시). 스냅샷을 다시 계산한다
  .patch("/contents/:id/posted-at", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const { postedAt } = parse(z.object({ postedAt: z.number().int().positive() }), await c.req.json());
    if (postedAt > Date.now() + 60_000) throw new ApiError(400, "future_time", "게시 시각은 지금보다 늦을 수 없습니다.");
    const row = await c.var.db
      .select({ id: contents.id })
      .from(contents)
      .innerJoin(guides, eq(guides.id, contents.guideId))
      .where(and(eq(contents.id, c.req.param("id")), eq(guides.workspaceId, workspace.id)))
      .get();
    if (!row) throw new ApiError(404, "content_not_found", "게시물을 찾을 수 없습니다.");
    await c.var.db.update(contents).set({ postedAt, postedAtSource: "manual" }).where(eq(contents.id, row.id));
    await scheduleSnapshots(c.var.db, c.env, row.id);
    return c.json({ ok: true });
  });
