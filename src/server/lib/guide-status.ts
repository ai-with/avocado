import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db";
import { approvals, consents, contents, guideInfluencers, guideViews, reviewRounds, submissions } from "../db/schema";

// 가이드 상세의 인플루언서별 단계 상태 한 줄 (F-57, US-25).
// null = 아직 그 기능(테이블)이 없어서 모름. 0 과 구분한다
export type StageSummary = {
  viewedAt: number | null;
  viewCount: number;
  consentedAt: number | null;
  consentWithdrawnAt: number | null;
  uploadVersion: number | null;
  uploadStatus: string | null;
  reviewRounds: number | null;
  approved: boolean | null;
  postUrl: string | null;
  // 브랜드와 인플루언서가 넣은 URL 이 다를 때 나중 값 (F-48: 먼저 들어온 값을 쓰고 브랜드가 확인)
  postConflictUrl?: string | null;
  connected: boolean | null;
  snapshots: number | null;
  leads: number | null;
};

const emptySummary = (): StageSummary => ({
  viewedAt: null,
  viewCount: 0,
  consentedAt: null,
  consentWithdrawnAt: null,
  uploadVersion: null,
  uploadStatus: null,
  reviewRounds: null,
  approved: null,
  postUrl: null,
  connected: null,
  snapshots: null,
  leads: null,
});

const tableCache = new Map<string, boolean>();
// 다른 워커가 만들 테이블이 있는지. 마이그레이션 후에만 바뀌므로 isolate 단위로 기억한다
export async function tableExists(db: Db, name: string): Promise<boolean> {
  const hit = tableCache.get(name);
  if (hit) return true;
  const row = await db.get<{ n: number }>(sql`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ${name}`);
  const exists = (row?.n ?? 0) > 0;
  if (exists) tableCache.set(name, true);
  return exists;
}

type Summaries = Map<string, StageSummary>;
type Link = { id: string; influencerId: string };

async function fillViews(db: Db, out: Summaries, ids: string[]) {
  const views = await db
    .select({ gi: guideViews.guideInfluencerId, first: sql<number>`min(${guideViews.openedAt})`, n: sql<number>`count(*)` })
    .from(guideViews)
    .where(inArray(guideViews.guideInfluencerId, ids))
    .groupBy(guideViews.guideInfluencerId);
  for (const v of views) Object.assign(out.get(v.gi)!, { viewedAt: v.first, viewCount: v.n });
}

async function fillConsentsAndUploads(db: Db, out: Summaries, ids: string[]) {
  const cs = await db.select().from(consents).where(inArray(consents.guideInfluencerId, ids)).orderBy(consents.agreedAt);
  for (const c of cs) Object.assign(out.get(c.guideInfluencerId)!, { consentedAt: c.agreedAt, consentWithdrawnAt: c.withdrawnAt });
  const subs = await db
    .select({ gi: submissions.guideInfluencerId, version: submissions.version, status: submissions.status })
    .from(submissions)
    .where(and(inArray(submissions.guideInfluencerId, ids), eq(submissions.kind, "final"), notInArray(submissions.status, ["uploading", "aborted"])))
    .orderBy(submissions.version);
  for (const s of subs) Object.assign(out.get(s.gi)!, { uploadVersion: s.version, uploadStatus: s.status });
}

// TASK-020: 검수 라운드 수, 최종 승인, 게시물 URL (F-62, F-48)
async function fillReview(db: Db, out: Summaries, ids: string[]) {
  const rounds = await db.select({ gi: reviewRounds.guideInfluencerId, n: sql<number>`max(${reviewRounds.n})` }).from(reviewRounds).where(inArray(reviewRounds.guideInfluencerId, ids)).groupBy(reviewRounds.guideInfluencerId);
  const approvedGi = new Set((await db.select({ gi: approvals.guideInfluencerId }).from(approvals).where(inArray(approvals.guideInfluencerId, ids))).map((a) => a.gi));
  const posts = await db.select({ gi: contents.guideInfluencerId, url: contents.url, conflictUrl: contents.conflictUrl }).from(contents).where(and(inArray(contents.guideInfluencerId, ids), isNull(contents.deletedAt)));
  for (const [gi, s] of out) Object.assign(s, { reviewRounds: 0, approved: approvedGi.has(gi) });
  for (const r of rounds) out.get(r.gi)!.reviewRounds = r.n;
  for (const p of posts) Object.assign(out.get(p.gi)!, { postUrl: p.url, postConflictUrl: p.conflictUrl });
}

// TASK-022: 연결 = 인플루언서 본인 인스타그램 연결(F-54), 스냅샷 = 수집 완료 시점 수(최대 3)
async function fillPerformance(db: Db, out: Summaries, guideId: string, links: Link[]) {
  const linked = await db.all<{ influencer_id: string }>(
    sql`SELECT DISTINCT c.influencer_id FROM ig_connections c JOIN guides g ON g.workspace_id = c.workspace_id WHERE g.id = ${guideId} AND c.target = 'influencer' AND c.connected_at IS NOT NULL AND c.revoked_at IS NULL`,
  );
  const snaps = await db.all<{ gi: string; n: number }>(
    sql`SELECT ct.guide_influencer_id AS gi, count(s.id) AS n FROM contents ct LEFT JOIN metric_snapshots s ON s.content_id = ct.id AND s.status = 'captured' WHERE ct.guide_id = ${guideId} AND ct.deleted_at IS NULL GROUP BY ct.guide_influencer_id`,
  );
  for (const l of links) Object.assign(out.get(l.id)!, { connected: linked.some((x) => x.influencer_id === l.influencerId), snapshots: 0 });
  for (const s of snaps) if (out.has(s.gi)) out.get(s.gi)!.snapshots = s.n;
}

async function fillLeads(db: Db, out: Summaries, guideId: string, links: Link[]) {
  if (!(await tableExists(db, "lead_sources"))) return;
  const infToGi = new Map(links.map((l) => [l.influencerId, l.id]));
  const rows = await db.all<{ influencer_id: string; n: number }>(
    sql`SELECT s.influencer_id, count(DISTINCT s.lead_id) AS n FROM lead_sources s JOIN leads l ON l.id = s.lead_id WHERE s.guide_id = ${guideId} AND s.influencer_id IS NOT NULL AND l.deleted_at IS NULL GROUP BY s.influencer_id`,
  );
  for (const s of out.values()) s.leads = 0;
  for (const r of rows) {
    const gi = infToGi.get(r.influencer_id);
    if (gi) out.get(gi)!.leads = r.n;
  }
}

export async function stageSummaries(db: Db, guideId: string): Promise<Summaries> {
  const links = await db.select({ id: guideInfluencers.id, influencerId: guideInfluencers.influencerId }).from(guideInfluencers).where(eq(guideInfluencers.guideId, guideId));
  const out = new Map(links.map((l) => [l.id, emptySummary()]));
  if (links.length === 0) return out;
  const ids = links.map((l) => l.id);
  await fillViews(db, out, ids);
  await fillConsentsAndUploads(db, out, ids);
  await fillReview(db, out, ids);
  await fillPerformance(db, out, guideId, links);
  await fillLeads(db, out, guideId, links);
  return out;
}

// 인플루언서 공개 가이드에 보여 줄 본인 리드 링크 (TASK-019 short_links). 없으면 빈 배열
export async function influencerLeadLinks(db: Db, shortBase: string, guideId: string, influencerId: string) {
  if (!(await tableExists(db, "short_links"))) return [];
  // 브랜드가 추가한 채널(custom:<id>) 이름을 보여 주려고 link_channels 를 붙인다. 콘텐츠별 링크는 빼고 칸의 기본 링크만
  const rows = await db.all<{ slug: string; channel_key: string; name: string | null }>(
    sql`SELECT l.slug, l.channel_key, c.name FROM short_links l LEFT JOIN link_channels c ON c.workspace_id = l.workspace_id AND c.key = l.channel_key
        WHERE l.guide_id = ${guideId} AND l.influencer_id = ${influencerId} AND l.deleted_at IS NULL AND l.content_key IS NULL ORDER BY l.channel_key`,
  );
  return rows.map((r) => ({ channel: r.channel_key, name: r.name ?? r.channel_key, url: `${shortBase}/${r.slug}` }));
}

// 홈 지표와 시작 체크리스트용 워크스페이스 집계
export async function workspaceCounts(db: Db, workspaceId: string) {
  const one = async (q: ReturnType<typeof sql>) => (await db.get<{ n: number }>(q))?.n ?? 0;
  const guidesN = await one(sql`SELECT count(*) AS n FROM guides WHERE workspace_id = ${workspaceId}`);
  const linksIssued = await one(sql`SELECT count(*) AS n FROM guide_influencers gi JOIN guides g ON g.id = gi.guide_id WHERE g.workspace_id = ${workspaceId}`);
  const viewed = await one(
    sql`SELECT count(DISTINCT v.guide_influencer_id) AS n FROM guide_views v JOIN guide_influencers gi ON gi.id = v.guide_influencer_id JOIN guides g ON g.id = gi.guide_id WHERE g.workspace_id = ${workspaceId}`,
  );
  const uploads = await one(
    sql`SELECT count(*) AS n FROM submissions s JOIN guide_influencers gi ON gi.id = s.guide_influencer_id JOIN guides g ON g.id = gi.guide_id WHERE g.workspace_id = ${workspaceId} AND s.status NOT IN ('uploading', 'aborted')`,
  );
  const leadLinks = (await tableExists(db, "short_links"))
    ? await one(sql`SELECT count(*) AS n FROM short_links l JOIN guides g ON g.id = l.guide_id WHERE g.workspace_id = ${workspaceId} AND l.deleted_at IS NULL`)
    : 0;
  const leads = (await tableExists(db, "leads")) ? await one(sql`SELECT count(*) AS n FROM leads WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL`) : 0;
  // 피드백을 한 번 이상 보냈거나 승인한 가이드 인플루언서 수 (TASK-020)
  const reviewed = await one(
    sql`SELECT count(*) AS n FROM guide_influencers gi JOIN guides g ON g.id = gi.guide_id WHERE g.workspace_id = ${workspaceId} AND (EXISTS (SELECT 1 FROM review_rounds r WHERE r.guide_influencer_id = gi.id) OR EXISTS (SELECT 1 FROM approvals a WHERE a.guide_influencer_id = gi.id))`,
  );
  return { guides: guidesN, linksIssued, viewed, uploads, leadLinks, leads, reviewed };
}

// 철회되지 않은 동의 조건
export const activeConsent = (giId: string) => and(eq(consents.guideInfluencerId, giId), isNull(consents.withdrawnAt));
