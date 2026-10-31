import { Hono } from "hono";
import { and, asc, avg, count, desc, eq, isNull, type SQL } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { documentPageViews, documentViews, influencers, leads, shortLinks } from "../../db/schema";
import { documentMetrics, documentOpenedAt, EMPTY_DOCUMENT_METRICS } from "../../lib/document-metrics";
import { openedNonMember, ownDocument } from "./shared";

// 열람 수, 완독률, 재열람, 페이지별 평균 체류, 링크(인플루언서·채널)별 유입, 리드와 연결된 열람

const LEAD_VIEWS_LIMIT = 100;

function pageStatsOf(db: Db, scope: SQL | undefined) {
  return db
    .select({ page: documentPageViews.page, viewers: count(), avgDwellMs: avg(documentPageViews.dwellMs).mapWith(Number) })
    .from(documentPageViews)
    .innerJoin(documentViews, eq(documentViews.id, documentPageViews.viewId))
    .where(scope)
    .groupBy(documentPageViews.page)
    .orderBy(asc(documentPageViews.page));
}

function leadViewsOf(db: Db, scope: SQL | undefined) {
  return db
    .select({ leadId: leads.id, email: leads.email, name: leads.name, maxPage: documentViews.maxPage, completed: documentViews.completed, startedAt: documentOpenedAt })
    .from(documentViews)
    .innerJoin(leads, eq(leads.id, documentViews.leadId))
    .where(and(scope, isNull(leads.deletedAt)))
    .orderBy(desc(documentOpenedAt))
    .limit(LEAD_VIEWS_LIMIT);
}

export const documentAnalyticsRoutes = new Hono<AppEnv>().get("/:id/analytics", async (c) => {
  const doc = await ownDocument(c, c.req.param("id"));
  const db = c.var.db;
  const scope = and(eq(documentViews.documentId, doc.id), openedNonMember);
  const [summary, pages, grouped, leadViews, links] = await Promise.all([
    documentMetrics(db, doc.workspaceId, { groupBy: "summary", documentId: doc.id }), pageStatsOf(db, scope),
    documentMetrics(db, doc.workspaceId, { groupBy: "link", documentId: doc.id }), leadViewsOf(db, scope),
    db.select({ id: shortLinks.id, channelKey: shortLinks.channelKey, influencerName: influencers.displayName }).from(shortLinks)
      .leftJoin(influencers, eq(influencers.id, shortLinks.influencerId)).where(eq(shortLinks.workspaceId, doc.workspaceId)),
  ]);
  const s = summary[0] ?? EMPTY_DOCUMENT_METRICS;
  const byLink = grouped.map(({ key, ...metrics }) => {
    const link = links.find((l) => l.id === key);
    return { ...metrics, linkId: key, channelKey: link?.channelKey ?? null, influencerName: link?.influencerName ?? null };
  }).sort((a, b) => b.views - a.views);
  return c.json({
    pages: doc.pages,
    ...s,
    unique: s.uniqueVisitors,
    completionRate: s.views ? s.completed / s.views : 0,
    pageStats: pages,
    byLink,
    leadViews,
  });
});
