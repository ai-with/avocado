import type { ConversionEvent } from "../../../shared/sdk-events";
import { newId } from "../ids";
import type { SessionAttribution } from "./attribution";
import type { DailyDelta, SessionDelta } from "./aggregate";

// Queue 소비자가 db.batch() 로 한 번에 보내는 쓰기 문장들 (D1 원시 SQL. 증분 upsert 가 Drizzle 보다 읽기 쉽다)

export type SessionKey = { siteId: string; sessionId: string; anonId: string };
export type SessionMeta = { attr: SessionAttribution; isMember: boolean; country: string | null; device: string; receivedAt?: number };

// 같은 익명 ID 로 이미 식별된 사람이 있으면 새 세션에 바로 붙인다
const PERSON_BY_ANON = `(SELECT p.id FROM site_people p, json_each(p.anon_ids) j
  WHERE p.site_id=? AND j.value=? AND p.created_at<=?
  AND (p.lead_id IS NULL OR EXISTS(SELECT 1 FROM leads l JOIN sites s ON s.workspace_id=l.workspace_id
    WHERE s.id=p.site_id AND l.id=p.lead_id AND l.deleted_at IS NULL AND l.created_at<=?))
  ORDER BY p.created_at DESC,p.id LIMIT 1)`;

export function upsertSession(db: D1Database, k: SessionKey, d: SessionDelta, m: SessionMeta) {
  return db
    .prepare(
      `INSERT INTO site_sessions (site_id, id, anon_id, person_id, link_id, click_token, match, first_at, last_at, pageviews, max_scroll, visible_ms, clicks, is_member, country, device)
       VALUES (?, ?, ?, ${PERSON_BY_ANON}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (site_id, id) DO UPDATE SET
         first_at = min(first_at, excluded.first_at), last_at = max(last_at, excluded.last_at),
         pageviews = pageviews + excluded.pageviews, max_scroll = max(max_scroll, excluded.max_scroll),
         visible_ms = visible_ms + excluded.visible_ms, clicks = clicks + excluded.clicks,
         is_member = max(is_member, excluded.is_member), person_id = coalesce(person_id, excluded.person_id)`,
    )
    .bind(k.siteId, k.sessionId, k.anonId, k.siteId, k.anonId, m.receivedAt ?? d.lastAt, m.receivedAt ?? d.lastAt, m.attr.linkId, m.attr.clickToken, m.attr.match, d.firstAt, d.lastAt, d.pageviews, d.maxScroll, d.visibleMs, d.clicks, m.isMember ? 1 : 0, m.country, m.device);
}

export function insertConversion(db: D1Database, k: SessionKey, linkId: string | null, e: ConversionEvent, currency: string, at: number, receivedAt = at, eligibleAtCapture?: boolean) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO site_conversions (id, site_id, session_id, person_id, link_id, kind, name, value, currency, order_id, at, received_at, eligible_at_capture)
       VALUES (?, ?, ?, (SELECT person_id FROM site_sessions WHERE site_id = ? AND id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(newId(), k.siteId, k.sessionId, k.siteId, k.sessionId, linkId, e.kind, e.name ?? null, e.value ?? null, e.currency ?? currency, e.orderId ?? null, at, receivedAt, eligibleAtCapture === undefined ? null : eligibleAtCapture ? 1 : 0);
}

// One physical SQL statement even at the 50-conversion limit. Preserve the same
// receipt time and membership snapshot used by the daily/currency aggregates.
export function insertConversionsBulk(db: D1Database, k: SessionKey, linkId: string | null, events: { event: ConversionEvent; at: number }[], currency: string, receivedAt?: number, eligibleAtCapture?: boolean) {
  const rows = events.map(({ event, at }) => ({ id: newId(), kind: event.kind, name: event.name ?? null, value: event.value ?? null, currency: event.currency ?? currency, orderId: event.orderId ?? null, at, receivedAt: receivedAt ?? at, eligibleAtCapture: eligibleAtCapture === undefined ? null : eligibleAtCapture ? 1 : 0 }));
  return db.prepare(`INSERT OR IGNORE INTO site_conversions (id,site_id,session_id,person_id,link_id,kind,name,value,currency,order_id,at,received_at,eligible_at_capture)
    SELECT json_extract(e.value,'$.id'),?,?,(SELECT person_id FROM site_sessions WHERE site_id=? AND id=?),?,
      json_extract(e.value,'$.kind'),json_extract(e.value,'$.name'),json_extract(e.value,'$.value'),
      json_extract(e.value,'$.currency'),json_extract(e.value,'$.orderId'),json_extract(e.value,'$.at'),
      json_extract(e.value,'$.receivedAt'),json_extract(e.value,'$.eligibleAtCapture') FROM json_each(?) e`)
    .bind(k.siteId, k.sessionId, k.siteId, k.sessionId, linkId, JSON.stringify(rows));
}

export function upsertDaily(db: D1Database, siteId: string, day: string, linkId: string | null, d: DailyDelta) {
  const reached = (step: number) => (d.scroll.includes(step) ? 1 : 0);
  return db
    .prepare(
      `INSERT INTO site_daily_stats (site_id, day, link_id, sessions, pageviews, scroll_25, scroll_50, scroll_75, scroll_100, conversions, conversion_value, members_excluded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (site_id, day, link_id) DO UPDATE SET
         sessions = sessions + excluded.sessions, pageviews = pageviews + excluded.pageviews,
         scroll_25 = scroll_25 + excluded.scroll_25, scroll_50 = scroll_50 + excluded.scroll_50,
         scroll_75 = scroll_75 + excluded.scroll_75, scroll_100 = scroll_100 + excluded.scroll_100,
         conversions = conversions + excluded.conversions, conversion_value = conversion_value + excluded.conversion_value,
         members_excluded = members_excluded + excluded.members_excluded`,
    )
    .bind(siteId, day, linkId ?? "", d.sessions, d.pageviews, reached(25), reached(50), reached(75), reached(100), d.conversions, d.conversionValue, d.membersExcluded);
}

export function insertEventIds(db: D1Database, siteId: string, ids: string[], at: number) {
  return db.prepare("INSERT OR IGNORE INTO site_event_ids (site_id, id, at) SELECT ?, value, ? FROM json_each(?)").bind(siteId, at, JSON.stringify(ids));
}

export function markFirstEvent(db: D1Database, siteId: string, at: number) {
  return db.prepare("UPDATE sites SET first_event_at = ? WHERE id = ? AND deleted_at IS NULL AND first_event_at IS NULL").bind(at, siteId);
}
