import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { linkChannels, shortLinks } from "../db/schema";
import { DEFAULT_CHANNELS, type DestinationType, type Utm } from "../../shared/leads";
import { newId, now } from "./ids";

const INSERT_CHUNK = 6;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// 7자 base62. 62^7 ≈ 3.5조라 충돌은 드물지만 호출 측이 unique 위반 시 다시 만든다
export function newSlug(len = 7): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => BASE62[b % 62]).join("");
}

// utm_source 는 채널 플랫폼. custom:<id> 는 custom
export function channelPlatform(channelKey: string): string {
  if (channelKey.startsWith("ig_")) return "instagram";
  if (channelKey === "threads" || channelKey === "email") return channelKey;
  return "custom";
}

export function buildUtm(channelKey: string, guideSlug: string, influencerHandle: string | null): Utm {
  return { source: channelPlatform(channelKey), medium: "influencer", campaign: guideSlug, content: influencerHandle ?? "shared", term: channelKey };
}

// 목적지 URL 에 UTM 을 붙인다. 이미 있는 utm_* 는 덮어쓴다(발급 화면에서 미리 경고)
export function appendUtm(url: string, utm: Utm): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(utm)) if (v) u.searchParams.set(`utm_${k}`, v);
  return u.toString();
}

export const hasUtm = (url: string) => /[?&]utm_[a-z]+=/i.test(url);

const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|facebookcatalog|slackbot|whatsapp|twitterbot|telegrambot|discordbot|kakaotalk-scrap|linkedinbot|embedly|headless|lighthouse|curl\/|wget|python-requests/i;
export const isBotUA = (ua: string | undefined) => !ua || BOT_RE.test(ua);

export function deviceOf(ua: string | undefined): "mobile" | "desktop" | "other" {
  if (!ua) return "other";
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return "mobile";
  if (/Windows|Macintosh|X11|Linux|CrOS/i.test(ua)) return "desktop";
  return "other";
}

// 워크스페이스에 기본 채널 6개가 없으면 만든다. 채널 목록을 읽는 모든 곳에서 먼저 부른다
export async function ensureChannels(db: Db, workspaceId: string) {
  const rows = await db.select().from(linkChannels).where(eq(linkChannels.workspaceId, workspaceId)).orderBy(asc(linkChannels.sort));
  const missing = DEFAULT_CHANNELS.filter((d) => !rows.some((r) => r.key === d.key));
  if (missing.length === 0) return rows;
  await db
    .insert(linkChannels)
    .values(missing.map((d) => ({ id: newId(), workspaceId, key: d.key, name: d.name, sort: DEFAULT_CHANNELS.findIndex((x) => x.key === d.key), createdAt: now() })))
    .onConflictDoNothing();
  return db.select().from(linkChannels).where(eq(linkChannels.workspaceId, workspaceId)).orderBy(asc(linkChannels.sort));
}

export type Destination = { type: DestinationType; id: string | null; url: string | null };
export type LinkTarget = { influencerId: string | null; handle: string | null };

// 기본 링크가 이미 있는 칸. 콘텐츠 링크만 있는 칸은 비어 있는 것으로 본다
export const takenBaseCells = (rows: { influencerId: string | null; channelKey: string; contentKey: string | null }[]) =>
  new Set(rows.filter((r) => r.contentKey === null).map((r) => `${r.influencerId ?? ""}|${r.channelKey}`));

// 대상(인플루언서 또는 공용) × 채널 링크를 만든다. 같은 가이드·대상·채널에 살아 있는 링크가 있으면 건너뛴다
export async function createShortLinks(
  db: Db,
  p: { workspaceId: string; guideId: string | null; guideSlug: string; targets: LinkTarget[]; channelKeys: string[]; destination: Destination },
): Promise<{ created: number; skipped: number }> {
  const existing = await db
    .select({ influencerId: shortLinks.influencerId, channelKey: shortLinks.channelKey, contentKey: shortLinks.contentKey })
    .from(shortLinks)
    .where(and(eq(shortLinks.workspaceId, p.workspaceId), p.guideId ? eq(shortLinks.guideId, p.guideId) : isNull(shortLinks.guideId), isNull(shortLinks.deletedAt)));
  const taken = takenBaseCells(existing);
  const values = [];
  for (const t of p.targets) {
    for (const ch of p.channelKeys) {
      if (taken.has(`${t.influencerId ?? ""}|${ch}`)) continue;
      values.push({
        id: newId(),
        workspaceId: p.workspaceId,
        guideId: p.guideId,
        influencerId: t.influencerId,
        channelKey: ch,
        slug: newSlug(),
        destinationType: p.destination.type,
        destinationId: p.destination.id,
        destinationUrl: p.destination.url,
        utm: buildUtm(ch, p.guideSlug, t.handle),
        og: {},
        createdAt: now(),
      });
    }
  }
  // D1 바인딩 변수 한도(100)를 넘지 않게 나눠 넣는다 (행당 최대 15열)
  for (let i = 0; i < values.length; i += INSERT_CHUNK) await db.insert(shortLinks).values(values.slice(i, i + INSERT_CHUNK));
  return { created: values.length, skipped: p.targets.length * p.channelKeys.length - values.length };
}
