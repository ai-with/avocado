import { Hono } from "hono";
import { and, asc, count, countDistinct, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { influencers, linkClicks, shortLinks } from "../../db/schema";
import { now } from "../../lib/ids";
import { realClick } from "../../lib/link-stats";
import { workspaceCtx } from "../../middleware/auth";

// 분석: 채널별·인플루언서별·일별·리퍼러·기기·국가. 봇과 구성원 클릭은 뺀다

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const GROUP_LIMIT = 50;
const TOP_N = 10;
// 일별은 한국 시간 기준
const KST_OFFSET_S = 32400;

function clickWhere(workspaceId: string, q: Record<string, string>, days: number): SQL | undefined {
  return and(
    eq(shortLinks.workspaceId, workspaceId),
    q.guideId ? eq(shortLinks.guideId, q.guideId) : undefined,
    q.linkId ? eq(shortLinks.id, q.linkId) : undefined,
    realClick,
    gte(linkClicks.at, now() - days * DAY_MS),
  );
}

function breakdowns(db: Db, where: SQL | undefined) {
  const base = <K extends string>(key: SQL<K>) =>
    db
      .select({ key, clicks: count(), unique: countDistinct(linkClicks.sessionId) })
      .from(linkClicks)
      .innerJoin(shortLinks, eq(shortLinks.id, linkClicks.linkId))
      .where(where)
      .groupBy(key)
      .orderBy(desc(count()))
      .limit(GROUP_LIMIT);
  const day = sql<string>`date(${linkClicks.at} / 1000 + ${sql.raw(String(KST_OFFSET_S))}, 'unixepoch')`;
  return Promise.all([
    base(sql<string>`${shortLinks.channelKey}`),
    base(sql<string>`coalesce(${shortLinks.influencerId}, '')`),
    db.select({ key: day, clicks: count() }).from(linkClicks).innerJoin(shortLinks, eq(shortLinks.id, linkClicks.linkId)).where(where).groupBy(day).orderBy(asc(day)),
    base(sql<string>`coalesce(${linkClicks.referrer}, '')`),
    base(sql<string>`${linkClicks.device}`),
    base(sql<string>`coalesce(${linkClicks.country}, '')`),
    db.select({ clicks: count(), unique: countDistinct(linkClicks.sessionId) }).from(linkClicks).innerJoin(shortLinks, eq(shortLinks.id, linkClicks.linkId)).where(where).get(),
  ]);
}

export const linkAnalyticsRoutes = new Hono<AppEnv>().get("/analytics", async (c) => {
  const { workspace } = workspaceCtx(c);
  const db = c.var.db;
  const days = Math.min(Number(c.req.query("days") ?? DEFAULT_DAYS) || DEFAULT_DAYS, MAX_DAYS);
  const [byChannel, byInfluencer, daily, referrers, devices, countries, total] = await breakdowns(db, clickWhere(workspace.id, c.req.query(), days));
  const names = await db.select({ id: influencers.id, name: influencers.displayName }).from(influencers).where(eq(influencers.workspaceId, workspace.id));
  return c.json({
    days,
    total: total ?? { clicks: 0, unique: 0 },
    byChannel,
    byInfluencer: byInfluencer.map((r) => ({ ...r, name: names.find((n) => n.id === r.key)?.name ?? "가이드 공용" })),
    daily,
    referrers: referrers.slice(0, TOP_N),
    devices,
    countries: countries.slice(0, TOP_N),
  });
});
