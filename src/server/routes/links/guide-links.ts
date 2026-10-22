import { Hono } from "hono";
import { z } from "zod";
import { and, countDistinct, eq, isNull } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { leads, leadSources, shortLinks } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { logEvent } from "../../lib/events";
import { getGuide } from "../../lib/guides";
import { createShortLinks, ensureChannels, hasUtm, type LinkTarget } from "../../lib/links";
import type { LinkStats } from "../../lib/link-stats";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { destinationSchema, guideInfluencerList, listLinks, resolveDestination } from "./shared";

// 가이드 상세 '리드 링크' 탭과 '리드' 탭(묶어 보기)이 쓰는 경로. /api/guides 아래에 붙는다

const issueBody = z.object({ destination: destinationSchema, target: z.union([z.literal("all"), z.literal("shared"), z.array(z.string()).min(1)]), channelKeys: z.array(z.string()).optional() });
type Influencer = Awaited<ReturnType<typeof guideInfluencerList>>[number];

// 인플루언서가 0명이거나 공용을 고르면 가이드 공용 행을 만든다
function linkTargets(target: z.infer<typeof issueBody>["target"], infl: Influencer[]): LinkTarget[] {
  const picked = Array.isArray(target) ? infl.filter((i) => target.includes(i.id)) : infl;
  if (Array.isArray(target) && picked.length === 0) throw new ApiError(400, "influencer_not_found", "이 가이드에 참여한 인플루언서를 골라 주세요.");
  if (target === "shared" || picked.length === 0) return [{ influencerId: null, handle: null }];
  return picked.map((i) => ({ influencerId: i.id, handle: i.igHandle ?? i.threadsHandle ?? i.name }));
}

function leadsByInfluencer(db: Db, guideId: string) {
  return db
    .select({ influencerId: shortLinks.influencerId, leads: countDistinct(leadSources.leadId) })
    .from(leadSources)
    .innerJoin(shortLinks, eq(shortLinks.id, leadSources.linkId))
    .innerJoin(leads, eq(leads.id, leadSources.leadId))
    .where(and(eq(shortLinks.guideId, guideId), isNull(leads.deletedAt)))
    .groupBy(shortLinks.influencerId);
}

export const guideLinkRoutes = new Hono<AppEnv>()
  .get("/:id/links", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const guide = await getGuide(db, workspace.id, c.req.param("id"));
    const [channels, infl, links] = await Promise.all([ensureChannels(db, workspace.id), guideInfluencerList(db, guide.id), listLinks(db, c.env, workspace.id, guide.id)]);
    return c.json({ guide, channels, influencers: infl, links });
  })
  .post("/:id/links/issue", editorsOnly, async (c) => {
    const body = parse(issueBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const guide = await getGuide(db, workspace.id, c.req.param("id"));
    const destination = await resolveDestination(db, workspace.id, body.destination);
    const channels = await ensureChannels(db, workspace.id);
    const channelKeys = body.channelKeys ? channels.map((ch) => ch.key).filter((k) => body.channelKeys!.includes(k)) : channels.map((ch) => ch.key);
    const targets = linkTargets(body.target, await guideInfluencerList(db, guide.id));
    const result = await createShortLinks(db, { workspaceId: workspace.id, guideId: guide.id, guideSlug: guide.slug, targets, channelKeys, destination });
    await logEvent(db, workspace.id, "short_link_created", { count: result.created, channel_count: channelKeys.length, guide_id: guide.id });
    return c.json({ ...result, utmOverwritten: destination.url ? hasUtm(destination.url) : false }, 201);
  })
  // F-53 묶어 보기: 인플루언서별 댓글 DM → 클릭 → 자료 열람 → 리드, 사이트 방문 → 스크롤 50% → 전환(클릭 ID 단위, docs/14 6-6)
  .get("/:id/funnel", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const guide = await getGuide(db, workspace.id, c.req.param("id"));
    const [infl, links] = await Promise.all([guideInfluencerList(db, guide.id), listLinks(db, c.env, workspace.id, guide.id)]);
    const leadCounts = await leadsByInfluencer(db, guide.id);
    const rows = [...infl.map((i) => ({ influencerId: i.id as string | null, name: i.name })), { influencerId: null, name: "가이드 공용" }].map((r) => {
      const mine = links.filter((l) => l.influencerId === r.influencerId);
      const sum = (k: keyof LinkStats) => mine.reduce((a, l) => a + l.stats[k], 0);
      const site = { siteVisited: sum("siteVisited"), siteScroll50: sum("siteScroll50"), siteConverted: sum("siteConverted"), siteConversionValue: sum("siteConversionValue") };
      // TODO(TASK-022): 댓글 키워드 DM 발송 테이블이 생기면 dmSent 를 집계한다
      return { ...r, dmSent: 0, clicks: sum("clicks"), views: sum("views"), leads: leadCounts.find((x) => x.influencerId === r.influencerId)?.leads ?? 0, ...site };
    });
    await logEvent(db, workspace.id, "funnel_viewed", { guide_id: guide.id });
    return c.json({ rows: rows.filter((r) => r.influencerId !== null || r.clicks + r.views + r.leads + r.siteVisited > 0) });
  });
