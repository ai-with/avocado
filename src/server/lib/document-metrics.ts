import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db";
import { documentViews } from "../db/schema";

// -1은 과거 정의/구 Worker 기록으로, 실제 열림 여부를 추정하지 않고 당시 시작 시각을 보존한다.
export const documentOpenedAt = sql<number>`CASE WHEN ${documentViews.openedAt} = -1 THEN ${documentViews.startedAt} ELSE ${documentViews.openedAt} END`;

export type DocumentMetrics = {
  clicks: number; measuredClicks: number; views: number; uniqueViews: number; reViews: number;
  unattributedViews: number; uniqueVisitors: number; completed: number; leads: number; avgScrollPct: number;
};
export const EMPTY_DOCUMENT_METRICS: DocumentMetrics = {
  clicks: 0, measuredClicks: 0, views: 0, uniqueViews: 0, reViews: 0,
  unattributedViews: 0, uniqueVisitors: 0, completed: 0, leads: 0, avgScrollPct: 0,
};
type Group = "link" | "document" | "influencer" | "summary";
export type MetricScope = { groupBy: Group; guideId?: string; documentId?: string; since?: number; until?: number };
export type DocumentMetricRow = DocumentMetrics & { key: string | null };
type RawMetric = Omit<DocumentMetricRow, "avgScrollPct"> & { avgScroll: number | null };

const groupKey = (group: Group, alias: string): SQL => group === "summary" ? sql`NULL` : sql.raw(`${alias}.${group === "document" ? "document_id" : group === "influencer" ? "influencer_id" : "link_id"}`);
const period = (column: SQL, scope: MetricScope) => sql.join([
  sql`1`, ...(scope.since === undefined ? [] : [sql`${column} >= ${scope.since}`]), ...(scope.until === undefined ? [] : [sql`${column} < ${scope.until}`]),
], sql` AND `);

// 전 화면의 클릭·자료 집계. 삭제 링크도 보존하며 기간은 [since, until), 클릭과 첫 열람 모두 같은 기간이다.
// 측정 가능한 클릭 당시 문서 snapshot과 실제 열린 view의 교집합만 분자에 들어간다.
export async function documentMetrics(db: Db, workspaceId: string, scope: MetricScope): Promise<DocumentMetricRow[]> {
  const clickGroup = scope.groupBy === "document" ? sql`source.document_id` : groupKey(scope.groupBy, "c");
  const viewGroup = groupKey(scope.groupBy, "v");
  const documentClicks = scope.groupBy === "document";
  const observedAt = sql`CASE WHEN v.opened_at = -1 THEN v.started_at ELSE v.opened_at END`;
  const rows = await db.all<RawMetric>(sql`
    WITH scoped_links AS (
      SELECT * FROM short_links l WHERE l.workspace_id = ${workspaceId}
        ${scope.guideId ? sql`AND l.guide_id = ${scope.guideId}` : sql``}
    ), scoped_documents AS (
      SELECT id FROM documents WHERE workspace_id = ${workspaceId}
        ${scope.documentId ? sql`AND id = ${scope.documentId}` : sql``}
    ), sources AS (
      SELECT l.id AS link_id, d.id AS document_id FROM scoped_links l JOIN scoped_documents d
        ON l.destination_type = 'document' AND l.destination_id = d.id
      UNION
      SELECT l.id, d.id FROM scoped_links l JOIN forms f ON l.destination_type = 'form' AND l.destination_id = f.id AND f.workspace_id = l.workspace_id
        JOIN scoped_documents d ON json_extract(f.after_submit, '$.type') = 'document' AND json_extract(f.after_submit, '$.documentId') = d.id
      UNION
      SELECT v.link_id, v.document_id FROM document_views v JOIN scoped_links l ON l.id = v.link_id JOIN scoped_documents d ON d.id = v.document_id
      UNION
      SELECT c.link_id, c.destination_id FROM link_clicks c JOIN scoped_links l ON l.id = c.link_id
        JOIN scoped_documents d ON c.destination_type = 'document' AND c.destination_id = d.id
    ), real_clicks AS (
      SELECT c.*, l.influencer_id FROM link_clicks c JOIN scoped_links l ON l.id = c.link_id
      WHERE c.is_bot = 0 AND c.is_member = 0 AND ${period(sql`c.at`, scope)}
        ${scope.documentId ? sql`AND EXISTS (SELECT 1 FROM sources s WHERE s.link_id = c.link_id)` : sql``}
    ), click_counts AS (
      SELECT ${clickGroup} AS key, count(*) AS clicks,
        sum(CASE WHEN c.click_token IS NOT NULL AND c.destination_type = 'document'
          AND EXISTS (SELECT 1 FROM scoped_documents d WHERE d.id = c.destination_id)
          ${documentClicks ? sql`AND c.destination_id = source.document_id` : sql``}
          THEN 1 ELSE 0 END) AS measuredClicks
      FROM real_clicks c ${documentClicks ? sql`JOIN sources source ON source.link_id = c.link_id` : sql``}
      GROUP BY ${clickGroup}
    ), opened_views AS (
      SELECT v.*, ${observedAt} AS observed_at, l.id AS scoped_link_id, l.influencer_id FROM document_views v JOIN scoped_documents d ON d.id = v.document_id
      LEFT JOIN scoped_links l ON l.id = v.link_id
      WHERE v.is_member = 0 AND v.opened_at IS NOT NULL AND ${period(observedAt, scope)}
        ${scope.guideId ? sql`AND l.id IS NOT NULL` : sql``}
    ), view_rows AS (
      SELECT v.id, v.document_id, v.scoped_link_id AS link_id, v.influencer_id, v.session_id, v.lead_id, v.completed, v.max_scroll_pct,
        c.id AS valid_click_id
      FROM opened_views v LEFT JOIN real_clicks c ON c.click_token = v.click_token AND c.link_id = v.scoped_link_id
        AND v.opened_at > 0 AND c.destination_type = 'document' AND c.destination_id = v.document_id AND c.at <= v.observed_at
    ), view_counts AS (
      SELECT ${viewGroup} AS key, count(*) AS views, count(DISTINCT v.valid_click_id) AS uniqueViews,
        count(v.session_id) - count(DISTINCT CASE WHEN v.session_id IS NOT NULL THEN json_array(v.document_id, v.session_id) END) AS reViews,
        sum(CASE WHEN v.valid_click_id IS NULL THEN 1 ELSE 0 END) AS unattributedViews,
        count(DISTINCT CASE WHEN v.session_id IS NOT NULL THEN json_array(v.document_id, v.session_id) ELSE json_array(v.document_id, v.id) END) AS uniqueVisitors,
        sum(v.completed) AS completed, count(DISTINCT v.lead_id) AS leads, avg(v.max_scroll_pct) AS avgScroll
      FROM view_rows v GROUP BY ${viewGroup}
    ), keys AS (SELECT key FROM click_counts UNION SELECT key FROM view_counts)
    SELECT k.key, coalesce(c.clicks, 0) AS clicks, coalesce(c.measuredClicks, 0) AS measuredClicks,
      coalesce(v.views, 0) AS views, coalesce(v.uniqueViews, 0) AS uniqueViews, coalesce(v.reViews, 0) AS reViews,
      coalesce(v.unattributedViews, 0) AS unattributedViews, coalesce(v.uniqueVisitors, 0) AS uniqueVisitors,
      coalesce(v.completed, 0) AS completed, coalesce(v.leads, 0) AS leads, v.avgScroll
    FROM keys k LEFT JOIN click_counts c ON c.key IS k.key LEFT JOIN view_counts v ON v.key IS k.key
  `);
  return rows.map(({ avgScroll, ...row }) => ({ ...row, avgScrollPct: Math.round(avgScroll ?? 0) }));
}
