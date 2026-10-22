import { Hono } from "hono";
import { and, asc, avg, count, countDistinct, desc, eq, isNull, sql, sum, type SQL } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { documentPageViews, documentViews, influencers, leads, shortLinks } from "../../db/schema";
import { notMember, ownDocument } from "./shared";

// 열람 수, 완독률, 재열람, 페이지별 평균 체류, 링크(인플루언서·채널)별 유입, 리드와 연결된 열람

const LEAD_VIEWS_LIMIT = 100;
const completedSum = () => sum(sql`${documentViews.completed}`).mapWith(Number);

function summaryOf(db: Db, scope: SQL | undefined) {
  return db
    .select({ views: count(), unique: countDistinct(documentViews.sessionId), completed: completedSum(), avgScroll: avg(documentViews.maxScrollPct).mapWith(Number) })
    .from(documentViews)
    .where(scope)
    .get();
}

function pageStatsOf(db: Db, scope: SQL | undefined) {
  return db
    .select({ page: documentPageViews.page, viewers: count(), avgDwellMs: avg(documentPageViews.dwellMs).mapWith(Number) })
    .from(documentPageViews)
    .innerJoin(documentViews, eq(documentViews.id, documentPageViews.viewId))
    .where(scope)
    .groupBy(documentPageViews.page)
    .orderBy(asc(documentPageViews.page));
}

function byLinkOf(db: Db, scope: SQL | undefined) {
  return db
    .select({ linkId: documentViews.linkId, channelKey: shortLinks.channelKey, influencerName: influencers.displayName, views: count(), completed: completedSum() })
    .from(documentViews)
    .leftJoin(shortLinks, eq(shortLinks.id, documentViews.linkId))
    .leftJoin(influencers, eq(influencers.id, shortLinks.influencerId))
    .where(scope)
    .groupBy(documentViews.linkId)
    .orderBy(desc(count()));
}

function leadViewsOf(db: Db, scope: SQL | undefined) {
  return db
    .select({ leadId: leads.id, email: leads.email, name: leads.name, maxPage: documentViews.maxPage, completed: documentViews.completed, startedAt: documentViews.startedAt })
    .from(documentViews)
    .innerJoin(leads, eq(leads.id, documentViews.leadId))
    .where(and(scope, isNull(leads.deletedAt)))
    .orderBy(desc(documentViews.startedAt))
    .limit(LEAD_VIEWS_LIMIT);
}

export const documentAnalyticsRoutes = new Hono<AppEnv>().get("/:id/analytics", async (c) => {
  const doc = await ownDocument(c, c.req.param("id"));
  const db = c.var.db;
  const scope = and(eq(documentViews.documentId, doc.id), notMember);
  const [summary, pages, byLink, leadViews] = await Promise.all([summaryOf(db, scope), pageStatsOf(db, scope), byLinkOf(db, scope), leadViewsOf(db, scope)]);
  const s = summary ?? { views: 0, unique: 0, completed: 0, avgScroll: 0 };
  return c.json({
    pages: doc.pages,
    views: s.views,
    unique: s.unique,
    reViews: Math.max(0, s.views - s.unique),
    completed: s.completed ?? 0,
    completionRate: s.views ? (s.completed ?? 0) / s.views : 0,
    avgScrollPct: Math.round(s.avgScroll ?? 0),
    pageStats: pages,
    byLink,
    leadViews,
  });
});
