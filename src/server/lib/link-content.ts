import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { shortLinks } from "../db/schema";
import type { Utm } from "../../shared/leads";
import { newSlug } from "./links";
import { newId, now } from "./ids";

// 콘텐츠별 리드 링크 (AIWITH-447). 기본 링크 한 칸에 콘텐츠마다 단축링크를 덧붙인다

type Link = typeof shortLinks.$inferSelect;
const CONTENT_KEY_RE = /^c(\d+)$/;
// 기본 링크를 첫 콘텐츠로 보고 덧붙이는 링크는 c2 부터 센다
const FIRST_CONTENT_NO = 2;
export const BASE_CONTENT_LABEL = "기본 링크";

// 지운 링크의 키도 다시 쓰지 않는다. 같은 키가 다른 콘텐츠의 클릭과 섞이지 않게
export function nextContentKey(used: (string | null)[]): string {
  const nums = used.map((k) => CONTENT_KEY_RE.exec(k ?? "")?.[1]).filter((n): n is string => !!n).map(Number);
  return `c${Math.max(FIRST_CONTENT_NO - 1, ...nums) + 1}`;
}

// 기본 링크 UTM 을 그대로 쓰고 utm_content 만 <핸들>_<콘텐츠 키> 로 바꾼다
export const contentUtm = (base: Utm, contentKey: string): Utm => ({ ...base, content: `${base.content}_${contentKey}` });

// 분석 묶음: 콘텐츠 이름이 없으면 기본 링크
export const contentBuckets = <T extends { key: string }>(rows: T[]) => rows.map((r) => ({ ...r, name: r.key || BASE_CONTENT_LABEL }));

export async function createContentLink(db: Db, base: Link, label: string) {
  const siblings = await db
    .select({ contentKey: shortLinks.contentKey })
    .from(shortLinks)
    .where(
      and(
        eq(shortLinks.workspaceId, base.workspaceId),
        base.guideId ? eq(shortLinks.guideId, base.guideId) : isNull(shortLinks.guideId),
        base.influencerId ? eq(shortLinks.influencerId, base.influencerId) : isNull(shortLinks.influencerId),
        eq(shortLinks.channelKey, base.channelKey),
        isNotNull(shortLinks.contentKey),
      ),
    );
  const contentKey = nextContentKey(siblings.map((s) => s.contentKey));
  const row = {
    id: newId(),
    workspaceId: base.workspaceId,
    guideId: base.guideId,
    influencerId: base.influencerId,
    channelKey: base.channelKey,
    slug: newSlug(),
    destinationType: base.destinationType,
    destinationId: base.destinationId,
    destinationUrl: base.destinationUrl,
    utm: contentUtm(base.utm, contentKey),
    og: base.og,
    contentKey,
    contentLabel: label,
    createdAt: now(),
  };
  await db.insert(shortLinks).values(row);
  return row;
}
