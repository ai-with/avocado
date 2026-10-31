import { z } from "zod";
import { and, eq, gte, inArray, sum } from "drizzle-orm";
import type { Db } from "../../db";
import { siteDailyStats, sites } from "../../db/schema";
import { newToken } from "../../lib/ids";
import { findLive } from "../../lib/owned";
import { normalizeDomain } from "../../lib/collect/origin";
import { kstDay } from "../../lib/collect/aggregate";
import { conversionTotals, type CurrencySnapshot } from "../../lib/site-fx";

// 사이트 분석 라우트 공용

type Site = typeof sites.$inferSelect;
const SITE_KEY_BYTES = 9;
const MAX_DOMAINS = 20;
const DAY_MS = 86_400_000;
export const SUMMARY_DAYS = 7;

export const newSiteKey = () => `site_${newToken(SITE_KEY_BYTES)}`;

const domainsSchema = z
  .array(z.string().max(253))
  .min(1, "도메인을 하나 이상 넣어 주세요.")
  .max(MAX_DOMAINS, `도메인은 ${MAX_DOMAINS}개까지 넣을 수 있어요.`)
  .transform((list, ctx) => {
    const out = list.map(normalizeDomain);
    if (out.some((d) => d === null)) ctx.addIssue({ code: "custom", message: "도메인 형식을 확인해 주세요. 예: example.com, *.example.com" });
    return [...new Set(out.filter((d): d is string => d !== null))];
  });

export const siteFields = {
  name: z.string().trim().min(1, "사이트 이름을 넣어 주세요.").max(60),
  domains: domainsSchema,
  consentMode: z.enum(["auto", "require"]),
  collectRawEmail: z.boolean(),
  currency: z.string().regex(/^[A-Z]{3}$/, "통화는 KRW 처럼 영문 대문자 3글자로 넣어 주세요."),
  attributionDays: z.number().int().min(1).max(90),
};

export const ownSite = (db: Db, workspaceId: string, id: string) => findLive(db, sites, id, workspaceId, { code: "site_not_found", message: "사이트를 찾을 수 없어요." });

// 설치 스니펫 (docs/14 8-1). 동의 필요 사이트는 require: SDK의 pending 은 동의 전에도 메모리 모드로 보내므로 쓰면 안 된다
export function snippetOf(site: Pick<Site, "siteKey" | "consentMode">, appUrl: string): string {
  const consent = site.consentMode === "require" ? ' data-consent="require"' : "";
  return [
    "<script>",
    "  window.avocado = window.avocado || function () { (window.avocado.q = window.avocado.q || []).push(arguments); };",
    "</script>",
    `<script async src="${appUrl}/sdk/v1.js" data-site="${site.siteKey}"${consent}></script>`,
  ].join("\n");
}

export type SiteSummary = { sessions: number; pageviews: number; conversions: number; conversionValue: number; conversionValuePending: number; conversionValueConverted: number };
const EMPTY: SiteSummary = { sessions: 0, pageviews: 0, conversions: 0, conversionValue: 0, conversionValuePending: 0, conversionValueConverted: 0 };

// 최근 N일(한국 시간 일자 기준, 오늘 포함) 사이트별 합계
export async function summaries(db: Db, sites: CurrencySnapshot[], days = SUMMARY_DAYS): Promise<Map<string, SiteSummary>> {
  const siteIds = sites.map((site) => site.id);
  if (siteIds.length === 0) return new Map();
  const since = kstDay(Date.now() - (days - 1) * DAY_MS);
  const rows = await db
    .select({
      siteId: siteDailyStats.siteId,
      sessions: sum(siteDailyStats.sessions).mapWith(Number),
      pageviews: sum(siteDailyStats.pageviews).mapWith(Number),
      conversions: sum(siteDailyStats.conversions).mapWith(Number),
    })
    .from(siteDailyStats)
    .where(and(inArray(siteDailyStats.siteId, siteIds), gte(siteDailyStats.day, since)))
    .groupBy(siteDailyStats.siteId);
  const values = await conversionTotals(db, sites, since);
  return new Map(siteIds.map((id) => {
    const value = values.find((r) => r.siteId === id);
    return [id, { ...EMPTY, ...rows.find((r) => r.siteId === id), conversionValue: value?.value ?? 0, conversionValuePending: value?.pending ?? 0, conversionValueConverted: value?.converted ?? 0 }];
  }));
}

export function toClient(site: Site, appUrl: string, summary: SiteSummary) {
  return {
    id: site.id,
    name: site.name,
    siteKey: site.siteKey,
    domains: site.allowedDomains,
    consentMode: site.consentMode,
    collectRawEmail: site.collectRawEmail,
    currency: site.currency,
    attributionDays: site.attributionDays,
    firstEventAt: site.firstEventAt,
    createdAt: site.createdAt,
    snippet: snippetOf(site, appUrl),
    summary,
  };
}

// 일별 추이 (요약 카드 아래 표)
export function dailyRows(db: Db, siteId: string, days = SUMMARY_DAYS) {
  const day = siteDailyStats.day;
  return db
    .select({
      day,
      sessions: sum(siteDailyStats.sessions).mapWith(Number),
      pageviews: sum(siteDailyStats.pageviews).mapWith(Number),
      scroll50: sum(siteDailyStats.scroll50).mapWith(Number),
      conversions: sum(siteDailyStats.conversions).mapWith(Number),
      membersExcluded: sum(siteDailyStats.membersExcluded).mapWith(Number),
    })
    .from(siteDailyStats)
    .where(and(eq(siteDailyStats.siteId, siteId), gte(day, kstDay(Date.now() - (days - 1) * DAY_MS))))
    .groupBy(day)
    .orderBy(day);
}
