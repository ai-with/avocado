import { and, count, countDistinct, eq, isNull, sql, sum } from "drizzle-orm";
import type { Db } from "../db";
import { leads, leadSources, linkClicks, shortLinks, siteConversions, siteSessions } from "../db/schema";
import { documentMetrics, type DocumentMetrics } from "./document-metrics";

// site*: 웹 SDK 사이트 집계(구성원 세션 제외). visited·scroll50·converted 는 '방문이 생긴 클릭 ID' 단위라 클릭 수를 넘지 않는다
export type SiteLinkStats = { siteSessions: number; siteVisited: number; siteScroll50: number; siteConverted: number; siteConversions: number; siteConversionValue: number };
export type LinkStats = Pick<DocumentMetrics, "clicks" | "measuredClicks" | "views" | "uniqueViews" | "reViews" | "unattributedViews"> & { unique: number; leads: number } & SiteLinkStats;
export const EMPTY_SITE_STATS: SiteLinkStats = { siteSessions: 0, siteVisited: 0, siteScroll50: 0, siteConverted: 0, siteConversions: 0, siteConversionValue: 0 };
export const EMPTY_LINK_STATS: LinkStats = { clicks: 0, unique: 0, measuredClicks: 0, views: 0, uniqueViews: 0, reViews: 0, unattributedViews: 0, leads: 0, ...EMPTY_SITE_STATS };
const DEEP_SCROLL_PCT = 50;

// 봇과 워크스페이스 구성원의 클릭은 집계에서 뺀다
export const realClick = and(eq(linkClicks.isBot, false), eq(linkClicks.isMember, false));

// 링크별 클릭(봇·구성원 제외), 고유 클릭 추정(session_id 기준), 열람 수, 리드 수
export async function statsByLink(db: Db, workspaceId: string, guideId?: string) {
  const scope = and(eq(shortLinks.workspaceId, workspaceId), guideId ? eq(shortLinks.guideId, guideId) : undefined);
  const [clicks, views, leadRows, site] = await Promise.all([
    db
      .select({ linkId: linkClicks.linkId, clicks: count(), unique: countDistinct(linkClicks.sessionId) })
      .from(linkClicks)
      .innerJoin(shortLinks, eq(shortLinks.id, linkClicks.linkId))
      .where(and(scope, realClick))
      .groupBy(linkClicks.linkId),
    documentMetrics(db, workspaceId, { groupBy: "link", guideId }),
    db
      .select({ linkId: leadSources.linkId, leads: countDistinct(leadSources.leadId) })
      .from(leadSources)
      .innerJoin(shortLinks, eq(shortLinks.id, leadSources.linkId))
      .innerJoin(leads, eq(leads.id, leadSources.leadId))
      .where(and(scope, isNull(leads.deletedAt)))
      .groupBy(leadSources.linkId),
    siteStatsByLink(db, scope),
  ]);
  const map = new Map<string, LinkStats>();
  const get = (id: string) => map.get(id) ?? (map.set(id, { ...EMPTY_LINK_STATS }), map.get(id)!);
  for (const r of clicks) Object.assign(get(r.linkId), { clicks: r.clicks, unique: r.unique });
  for (const r of views) if (r.key) Object.assign(get(r.key), { clicks: r.clicks, measuredClicks: r.measuredClicks, views: r.views, uniqueViews: r.uniqueViews, reViews: r.reViews, unattributedViews: r.unattributedViews });
  for (const r of leadRows) if (r.linkId) get(r.linkId).leads = r.leads;
  for (const [linkId, st] of site) Object.assign(get(linkId), st);
  return map;
}

const clickOnly = (cond: ReturnType<typeof sql>) => sql<number>`count(DISTINCT CASE WHEN ${siteSessions.match} = 'click' AND ${cond} THEN ${siteSessions.clickToken} END)`;

// 링크별 사이트 세션·클릭 ID 단계·전환. 구성원 클릭에서 시작한 세션은 뺀다
async function siteStatsByLink(db: Db, scope: ReturnType<typeof and>) {
  const notMember = eq(siteSessions.isMember, false);
  const [sessions, conversions] = await Promise.all([
    db
      .select({ linkId: siteSessions.linkId, sessions: count(), visited: clickOnly(sql`1`), scroll50: clickOnly(sql`${siteSessions.maxScroll} >= ${DEEP_SCROLL_PCT}`) })
      .from(siteSessions)
      .innerJoin(shortLinks, eq(shortLinks.id, siteSessions.linkId))
      .where(and(scope, notMember))
      .groupBy(siteSessions.linkId),
    db
      .select({ linkId: siteSessions.linkId, converted: countDistinct(siteSessions.clickToken), conversions: count(), value: sum(siteConversions.value).mapWith(Number) })
      .from(siteConversions)
      .innerJoin(siteSessions, and(eq(siteSessions.siteId, siteConversions.siteId), eq(siteSessions.id, siteConversions.sessionId)))
      .innerJoin(shortLinks, eq(shortLinks.id, siteSessions.linkId))
      .where(and(scope, notMember))
      .groupBy(siteSessions.linkId),
  ]);
  const map = new Map<string, SiteLinkStats>();
  const get = (id: string) => map.get(id) ?? (map.set(id, { ...EMPTY_SITE_STATS }), map.get(id)!);
  for (const r of sessions) if (r.linkId) Object.assign(get(r.linkId), { siteSessions: r.sessions, siteVisited: Number(r.visited), siteScroll50: Number(r.scroll50) });
  for (const r of conversions) if (r.linkId) Object.assign(get(r.linkId), { siteConverted: r.converted, siteConversions: r.conversions, siteConversionValue: r.value ?? 0 });
  return map;
}
