import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../../db";
import { documents, forms, guideInfluencers, guides, influencers, shortLinks } from "../../db/schema";
import { ApiError } from "../../lib/errors";
import { findLive } from "../../lib/owned";
import { EMPTY_LINK_STATS, statsByLink } from "../../lib/link-stats";
import type { Destination } from "../../lib/links";

// 단축링크 라우트 공용

export const destinationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("document"), id: z.string().min(1) }),
  z.object({ type: z.literal("form"), id: z.string().min(1) }),
  z.object({ type: z.literal("url"), url: z.url({ protocol: /^https?$/, error: "http 또는 https 로 시작하는 주소를 넣어 주세요." }) }),
]);

export function guideInfluencerList(db: Db, guideId: string) {
  return db
    .select({ id: influencers.id, name: influencers.displayName, igHandle: influencers.igHandle, threadsHandle: influencers.threadsHandle })
    .from(guideInfluencers)
    .innerJoin(influencers, eq(influencers.id, guideInfluencers.influencerId))
    .where(eq(guideInfluencers.guideId, guideId))
    .orderBy(asc(guideInfluencers.createdAt));
}

// 목적지가 이 워크스페이스의 살아 있는 자료·폼인지 확인한다
export async function resolveDestination(db: Db, workspaceId: string, d: z.infer<typeof destinationSchema>): Promise<Destination> {
  if (d.type === "url") return { type: "url", id: null, url: d.url };
  const table = d.type === "document" ? documents : forms;
  const row = await db.select({ id: table.id }).from(table).where(and(eq(table.id, d.id), eq(table.workspaceId, workspaceId), isNull(table.deletedAt))).get();
  if (!row) throw new ApiError(404, "destination_not_found", d.type === "document" ? "자료를 찾을 수 없어요." : "폼을 찾을 수 없어요.");
  return { type: d.type, id: d.id, url: null };
}

export async function listLinks(db: Db, env: Env, workspaceId: string, guideId?: string) {
  const rows = await db
    .select({ link: shortLinks, guideName: guides.name, influencerName: influencers.displayName })
    .from(shortLinks)
    .leftJoin(guides, eq(guides.id, shortLinks.guideId))
    .leftJoin(influencers, eq(influencers.id, shortLinks.influencerId))
    .where(and(eq(shortLinks.workspaceId, workspaceId), guideId ? eq(shortLinks.guideId, guideId) : undefined, isNull(shortLinks.deletedAt)))
    .orderBy(asc(shortLinks.createdAt));
  const stats = await statsByLink(db, workspaceId, guideId);
  return rows.map(({ link, guideName, influencerName }) => ({
    id: link.id,
    slug: link.slug,
    url: `${env.PUBLIC_SHORT_BASE}/${link.slug}`,
    guideId: link.guideId,
    guideName,
    influencerId: link.influencerId,
    influencerName,
    channelKey: link.channelKey,
    destinationType: link.destinationType,
    destinationId: link.destinationId,
    destinationUrl: link.destinationUrl,
    utm: link.utm,
    og: link.og,
    createdAt: link.createdAt,
    stats: stats.get(link.id) ?? EMPTY_LINK_STATS,
  }));
}

export const ownLink = (db: Db, workspaceId: string, id: string) => findLive(db, shortLinks, id, workspaceId, { code: "link_not_found", message: "링크를 찾을 수 없어요." });
