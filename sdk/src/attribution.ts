import type { AttributionTouch, StoredAttribution, UtmKey } from "../../src/shared/sdk-events";
import { KEY_ATTR } from "./config";
import type { SdkStorage } from "./storage";

const DAY_MS = 24 * 60 * 60 * 1000;
export const CLICK_ID_PARAM = "avc";
export const MEMBER_PARAM = "avc_optout";
const UTM_KEYS: readonly UtmKey[] = ["source", "medium", "campaign", "content", "term"];
// 서버가 발급하는 클릭 토큰 형식. 손으로 고친 값은 봉투 전체가 거절되지 않게 버린다
const CLICK_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

function referrerHostOf(referrer: string, currentHost: string): string | null {
  try {
    const host = new URL(referrer).hostname;
    return host && host !== currentHost ? host : null;
  } catch {
    return null;
  }
}

/** avc 또는 utm_*가 있는 방문만 터치로 친다. 직접 방문·내부 이동은 null (docs/14 4-2) */
export function parseTouch(url: URL, referrer: string, now: number): AttributionTouch | null {
  const rawClickId = url.searchParams.get(CLICK_ID_PARAM);
  const clickId = rawClickId && CLICK_ID_PATTERN.test(rawClickId) ? rawClickId : null;
  const utm: AttributionTouch["utm"] = {};
  for (const key of UTM_KEYS) {
    const value = url.searchParams.get(`utm_${key}`);
    if (value) utm[key] = value;
  }
  if (!clickId && Object.keys(utm).length === 0) return null;
  return { clickId, utm, referrerHost: referrerHostOf(referrer, url.hostname), landingPath: url.pathname, at: now };
}

/** first는 보관 기간 안에서 덮지 않고, last는 새 터치로 갱신한다. 만료되면 버린다 */
export function mergeTouch(
  stored: StoredAttribution | null,
  touch: AttributionTouch | null,
  now: number,
  days: number,
): StoredAttribution | null {
  const alive = stored && stored.expiresAt > now ? stored : null;
  if (!touch) return alive;
  return { first: alive?.first ?? touch, last: touch, expiresAt: now + days * DAY_MS };
}

export function loadAttribution(storage: SdkStorage, now: number): StoredAttribution | null {
  const stored = storage.getJson<StoredAttribution>(KEY_ATTR);
  if (stored && stored.expiresAt > now) return stored;
  if (stored) storage.remove(KEY_ATTR);
  return null;
}

export function saveTouch(
  storage: SdkStorage,
  touch: AttributionTouch | null,
  now: number,
  days: number,
): StoredAttribution | null {
  const merged = mergeTouch(loadAttribution(storage, now), touch, now, days);
  if (merged && touch) storage.setJson(KEY_ATTR, merged);
  return merged;
}

/** 공유된 URL로 다른 사람이 같은 클릭 ID를 쓰지 않게 주소창에서 avc만 지운다 */
export function stripTrackingParams(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(CLICK_ID_PARAM) && !url.searchParams.has(MEMBER_PARAM)) return null;
  url.searchParams.delete(CLICK_ID_PARAM);
  url.searchParams.delete(MEMBER_PARAM);
  return url.toString();
}

/** 이벤트 url: 쿼리 중 utm_*, avc만 남기고 해시는 버린다 (docs/14 5-1, 7장 최소 수집) */
export function cleanEventUrl(href: string): string {
  const url = new URL(href);
  const kept = new URLSearchParams();
  url.searchParams.forEach((value, key) => {
    if (key === CLICK_ID_PARAM || key.startsWith("utm_")) kept.append(key, value);
  });
  const query = kept.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}
