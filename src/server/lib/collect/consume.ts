import type { ConversionEvent, Envelope } from "../../../shared/sdk-events";
import type { PipelineMessage } from "../../jobs";
import { correctedTs, dailyDelta, kstDay, sessionDelta, type SessionDelta } from "./aggregate";
import { resolveAttribution, type SessionAttribution } from "./attribution";
import { applyIdentify, type IdentifyJob } from "./people";
import { insertConversion, insertEventIds, markFirstEvent, upsertDaily, upsertSession, type SessionKey } from "./statements";

// Queue avocado-collect 소비자 (docs/14 6-3). 배치를 사이트별로 묶어 D1 batch 한 번으로 쓴다

export type CollectMessage = { siteId: string; workspaceId: string; receivedAt: number; country: string | null; device: string; envelope: Envelope };
type SiteRow = { id: string; workspaceId: string; currency: string; collectRawEmail: boolean };
type KnownSession = { maxScroll: number; attr: SessionAttribution; isMember: boolean };
type SiteState = { site: SiteRow; seen: Set<string>; sessions: Map<string, KnownSession>; orders: Set<string> };

const inJson = (values: string[]) => JSON.stringify([...new Set(values)]);

async function loadState(db: D1Database, siteId: string, msgs: CollectMessage[]): Promise<SiteState | null> {
  const site = await db
    .prepare("SELECT id, workspace_id AS workspaceId, currency, collect_raw_email AS collectRawEmail FROM sites WHERE id = ? AND deleted_at IS NULL")
    .bind(siteId)
    .first<SiteRow>();
  if (!site) return null;
  const events = msgs.flatMap((m) => m.envelope.events);
  const orders = events.flatMap((e) => (e.t === "conversion" && e.orderId ? [e.orderId] : []));
  const [seen, sessions, known] = (await db.batch([
    db.prepare("SELECT id FROM site_event_ids WHERE site_id = ? AND id IN (SELECT value FROM json_each(?))").bind(siteId, inJson(events.map((e) => e.id))),
    db
      .prepare("SELECT id, max_scroll AS maxScroll, link_id AS linkId, click_token AS clickToken, match, is_member AS isMember FROM site_sessions WHERE site_id = ? AND id IN (SELECT value FROM json_each(?))")
      .bind(siteId, inJson(msgs.map((m) => m.envelope.sess))),
    db.prepare("SELECT order_id AS id FROM site_conversions WHERE site_id = ? AND order_id IN (SELECT value FROM json_each(?))").bind(siteId, inJson(orders)),
  ])) as [D1Result, D1Result, D1Result];
  type SessionRow = { id: string; maxScroll: number; linkId: string | null; clickToken: string | null; match: SessionAttribution["match"]; isMember: number };
  const sessionMap = new Map(
    (sessions.results as SessionRow[]).map((r) => [r.id, { maxScroll: r.maxScroll, isMember: r.isMember === 1, attr: { linkId: r.linkId, clickToken: r.clickToken, match: r.match, isMember: r.isMember === 1 } }]),
  );
  const ids = (r: D1Result) => new Set((r.results as { id: string }[]).map((x) => x.id));
  return { site: { ...site, collectRawEmail: !!site.collectRawEmail }, seen: ids(seen), sessions: sessionMap, orders: ids(known) };
}

// 주문 번호가 이미 있거나 이 배치에서 본 전환은 뺀다 (새로고침 중복 방지)
function freshConversions(state: SiteState, list: ConversionEvent[]): ConversionEvent[] {
  return list.filter((c) => {
    if (!c.orderId) return true;
    if (state.orders.has(c.orderId)) return false;
    state.orders.add(c.orderId);
    return true;
  });
}

function writesFor(db: D1Database, state: SiteState, m: CollectMessage, d: SessionDelta, known: KnownSession) {
  const env = m.envelope;
  const key: SessionKey = { siteId: state.site.id, sessionId: env.sess, anonId: env.anon };
  const conversions = freshConversions(state, d.conversions);
  const prevMax = state.sessions.has(env.sess) ? known.maxScroll : null;
  const daily = dailyDelta(d, conversions, prevMax, known.isMember, state.site.currency);
  state.sessions.set(env.sess, { ...known, maxScroll: Math.max(known.maxScroll, d.maxScroll) });
  return [
    upsertSession(db, key, d, { attr: known.attr, isMember: known.isMember, country: m.country, device: m.device }),
    ...conversions.map((c) => insertConversion(db, key, known.attr.linkId, c, state.site.currency, correctedTs(c.ts, env, m.receivedAt), m.receivedAt, !known.isMember)),
    upsertDaily(db, state.site.id, kstDay(m.receivedAt), known.attr.linkId, daily),
  ];
}

async function knownSession(db: D1Database, state: SiteState, m: CollectMessage): Promise<KnownSession> {
  const prev = state.sessions.get(m.envelope.sess);
  if (prev) return { ...prev, isMember: prev.isMember || !!m.envelope.member };
  const attr = await resolveAttribution(db, m.workspaceId, m.envelope);
  // 구성원 클릭에서 시작한 세션 전체를 '내 조회 제외'로 본다 (docs/14 6-2 6a). SDK 의 구성원 표시도 같이 따른다
  return { maxScroll: 0, attr, isMember: attr.isMember || !!m.envelope.member };
}

async function processSite(env: Env, siteId: string, msgs: CollectMessage[]): Promise<IdentifyJob[]> {
  const state = await loadState(env.DB, siteId, msgs);
  if (!state) return [];
  const writes: D1PreparedStatement[] = [];
  const jobs: IdentifyJob[] = [];
  const newIds: string[] = [];
  for (const m of msgs) {
    const d = sessionDelta(m.envelope, m.receivedAt, state.seen);
    if (!d) continue;
    const fresh = m.envelope.events.filter((e) => !state.seen.has(e.id)).map((e) => e.id);
    for (const id of fresh) state.seen.add(id);
    newIds.push(...fresh);
    const known = await knownSession(env.DB, state, m);
    writes.push(...writesFor(env.DB, state, m, d, known));
    // 동의 전(pending)에는 사람 연결을 하지 않는다 (docs/14 7장)
    if (m.envelope.consent !== "granted") continue;
    for (const event of d.identifies) jobs.push({ site: state.site, anonId: m.envelope.anon, sessionId: m.envelope.sess, linkId: known.attr.linkId, event, receivedAt: m.receivedAt });
  }
  if (writes.length === 0) return [];
  const at = Math.max(...msgs.map((m) => m.receivedAt));
  // 이벤트 ID 기록을 같은 batch(트랜잭션)에 넣어 실패 후 재시도 때 이벤트가 빠지지 않게 한다
  await env.DB.batch([...writes, insertEventIds(env.DB, siteId, newIds, at), markFirstEvent(env.DB, siteId, at)]);
  return jobs;
}

export async function consumeCollect(batch: MessageBatch<PipelineMessage>, env: Env) {
  const bySite = new Map<string, CollectMessage[]>();
  for (const msg of batch.messages) {
    const m = msg.body.payload as CollectMessage;
    bySite.set(m.siteId, [...(bySite.get(m.siteId) ?? []), m]);
  }
  const jobs: IdentifyJob[] = [];
  for (const [siteId, msgs] of bySite) jobs.push(...(await processSite(env, siteId, msgs)));
  // ponytail: identify 는 집계 batch 뒤에 따로 처리한다. 여기서 실패하면 재시도 때 이벤트 ID 중복으로 건너뛰어 사람 연결만 빠진다. 잦으면 별도 메시지로 분리
  for (const job of jobs) await applyIdentify(env, job).catch((e: unknown) => console.error("[collect] identify", e));
}

// 24시간 지난 중복 제거 기록 정리 (cron)
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
export async function pruneEventIds(env: Env) {
  await env.DB.prepare("DELETE FROM site_event_ids WHERE at < ?").bind(Date.now() - DEDUPE_WINDOW_MS).run();
}
