import { sql } from "drizzle-orm";
import type { Db } from "../db";

// Analysis reference rates only: https://www.ecb.europa.eu/stats/eurofxref/
export const ECB_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MAX_BYTES = 256 * 1024;
type RateDay = { day: string; rates: Record<string, number> };
const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);

export function parseEcbRates(xml: string, at: number): RateDay[] {
  const invalid = () => { throw new Error("fx_invalid_response"); };
  if (new TextEncoder().encode(xml).byteLength > MAX_BYTES || /<!DOCTYPE|<!ENTITY|&/i.test(xml)) invalid();
  let document = xml.trim();
  if (document.startsWith("<?xml")) {
    const declaration = /^<\?xml\s+version=(["'])1\.0\1(?:\s+encoding=(["'])UTF-8\2)?\s*\?>/i.exec(document);
    if (!declaration) invalid();
    document = document.slice(declaration![0].length).trim();
  }
  const opening = /^<gesmes:Envelope\b([^<>]*)>/.exec(document), closing = "</gesmes:Envelope>";
  if (!opening || !document.endsWith(closing)) invalid();
  const attrs = opening![1]!, attrPattern = /\s+([A-Za-z_:][\w:.-]*)\s*=\s*(["'])([^"'<>&]*)\2/g;
  const names = new Map<string, string>();
  for (const match of attrs.matchAll(attrPattern)) {
    if (names.has(match[1]!)) invalid(); names.set(match[1]!, match[3]!);
  }
  if (attrs.replace(attrPattern, "").trim() || names.get("xmlns:gesmes") !== "http://www.gesmes.org/xml/2002-08-01" || names.get("xmlns") !== "http://www.ecb.int/vocabulary/2002-08-01/eurofxref") invalid();
  let inner = document.slice(opening![0].length, -closing.length).trim();
  inner = inner.replace(/^<gesmes:subject>[^<>]*<\/gesmes:subject>\s*/, "")
    .replace(/^<gesmes:Sender>\s*<gesmes:name>[^<>]*<\/gesmes:name>\s*<\/gesmes:Sender>\s*/, "");
  const cube = /^<Cube>([\s\S]*)<\/Cube>$/.exec(inner);
  if (!cube) invalid();
  const body = cube![1]!, dayPattern = /<Cube\s+time=(["'])([^"'<>]{1,40})\1\s*>([\s\S]*?)<\/Cube>/g;
  const out: RateDay[] = [], seen = new Set<string>();
  const blocks = [...body.matchAll(dayPattern)];
  if (!blocks.length || blocks.length > 100 || body.replace(dayPattern, "").trim()) invalid();
  for (const block of blocks) {
    const day = block[2]!, body = block[3]!;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || utcDay(Date.parse(day)) !== day || day > utcDay(at) || seen.has(day)) throw new Error("fx_invalid_response");
    const rates: Record<string, number> = { EUR: 1 };
    const currencies = /<Cube\s+currency=(["'])([A-Z]{3})\1\s+rate=(["'])((?:0|[1-9]\d{0,8})(?:\.\d{1,10})?)\3\s*\/>/g;
    const entries = [...body.matchAll(currencies)];
    if (!entries.length || entries.length > 50 || body.replace(currencies, "").trim()) throw new Error("fx_invalid_response");
    for (const entry of entries) {
      const currency = entry[2]!, rate = Number(entry[4]);
      if (currency in rates || !Number.isFinite(rate) || rate <= 0) throw new Error("fx_invalid_response");
      rates[currency] = rate;
    }
    seen.add(day); out.push({ day, rates });
  }
  if (out.every((item) => item.day < utcDay(at - 7 * DAY))) throw new Error("fx_stale_response");
  return out;
}

async function fetchRates(at: number): Promise<RateDay[]> {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(ECB_RATES_URL, { redirect: "manual", signal: controller.signal, headers: { Accept: "application/xml,text/xml" } });
    if (!response.ok || Number(response.headers.get("Content-Length")) > MAX_BYTES || !response.body) { void response.body?.cancel().catch(() => {}); throw new Error("fx_unavailable"); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { void reader.cancel().catch(() => {}); throw new Error("fx_invalid_response"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return parseEcbRates(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes), at);
  } finally { clearTimeout(timeout); }
}

// Cron: one global row, one bounded Queue message; no per-site scan.
export async function enqueueFxRefresh(env: Env) {
  const at = Date.now(), next = at + HOUR;
  const claimed = await env.DB.prepare("UPDATE site_fx_refresh SET next_enqueue_at=? WHERE id='ecb' AND next_enqueue_at<=? AND next_attempt_at<=? AND last_success_at<=? RETURNING id")
    .bind(next, at, at, at - 12 * HOUR).all();
  if (!claimed.results.length) return;
  try { await env.PIPELINE.sendBatch([{ body: { type: "site_fx_refresh", payload: {} } }]); }
  catch {
    await env.DB.prepare("UPDATE site_fx_refresh SET next_enqueue_at=? WHERE id='ecb' AND next_enqueue_at=?").bind(at, next).run();
    throw new Error("fx_enqueue_failed");
  }
}

export async function refreshFxRates(_payload: unknown, env: Env) {
  const at = Date.now(), lease = at + 30_000;
  const claimed = await env.DB.prepare("UPDATE site_fx_refresh SET lease_until=? WHERE id='ecb' AND lease_until<=? AND next_attempt_at<=? AND last_success_at<=? RETURNING id")
    .bind(lease, at, at, at - 12 * HOUR).all();
  if (!claimed.results.length) return;
  try {
    const rows = await fetchRates(at);
    // <=100 public date rows in one statement, guarded by this consumer's lease.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO site_fx_rates(day,rates,fetched_at)
        SELECT json_extract(value,'$.day'),json_extract(value,'$.rates'),? FROM json_each(?)
        WHERE EXISTS(SELECT 1 FROM site_fx_refresh WHERE id='ecb' AND lease_until=?)
        ON CONFLICT(day) DO UPDATE SET rates=excluded.rates,fetched_at=excluded.fetched_at WHERE rates<>excluded.rates`)
        .bind(at, JSON.stringify(rows), lease),
      env.DB.prepare("UPDATE site_fx_refresh SET lease_until=0,last_success_at=?,next_attempt_at=? WHERE id='ecb' AND lease_until=?").bind(at, at + 12 * HOUR, lease),
    ]);
  } catch {
    await env.DB.prepare("UPDATE site_fx_refresh SET lease_until=0,next_attempt_at=? WHERE id='ecb' AND lease_until=?").bind(at + HOUR, lease).run();
    console.warn("[fx] reference_rates_unavailable");
  }
}

export type FxTotal = { siteId: string; value: number; pending: number; converted: number };
export type CurrencySnapshot = { id: string; currency: string };
export async function conversionTotals(db: Db, sites: CurrencySnapshot[], sinceDay: string): Promise<FxTotal[]> {
  if (!sites.length) return [];
  const requested = [...new Map(sites.map(({ id, currency }) => [id, { id, currency }])).values()];
  const rows = await db.all<Omit<FxTotal, "value"> & { value: number | null; valued: number }>(sql`WITH eligible AS (
    SELECT t.site_id,t.value_sum AS value,t.valued_count,t.currency,json_extract(requested.value,'$.currency') AS base,t.occurred_day AS fx_day
    FROM site_currency_totals t JOIN sites s ON s.id=t.site_id AND s.deleted_at IS NULL
    JOIN json_each(${JSON.stringify(requested)}) requested ON json_extract(requested.value,'$.id')=t.site_id
    WHERE t.received_day>=${sinceDay}
  ), quoted AS (
    SELECT *, (SELECT rates FROM site_fx_rates f WHERE f.day<=fx_day AND f.day>=date(fx_day,'-7 days') ORDER BY f.day DESC LIMIT 1) AS rates FROM eligible
  ), priced AS (
    SELECT *, CASE WHEN currency=base THEN value
      WHEN currency GLOB '[A-Z][A-Z][A-Z]' AND base GLOB '[A-Z][A-Z][A-Z]'
        AND json_type(rates,'$.'||currency) IN ('integer','real') AND json_type(rates,'$.'||base) IN ('integer','real')
        AND json_extract(rates,'$.'||currency)>0 AND json_extract(rates,'$.'||base)>0
      THEN value*(1.0*json_extract(rates,'$.'||base)/json_extract(rates,'$.'||currency)) ELSE NULL END AS amount FROM quoted
  ) SELECT site_id AS siteId,sum(amount) AS value,
    sum(CASE WHEN amount IS NULL THEN valued_count ELSE 0 END) AS pending,
    sum(CASE WHEN amount IS NOT NULL AND currency<>base THEN valued_count ELSE 0 END) AS converted,sum(valued_count) AS valued
    FROM priced GROUP BY site_id`);
  // JSON cannot represent overflowing sums. Keep coverage explicit rather than
  // returning null/Infinity or presenting an incomplete amount as a full total.
  return rows.map(({ valued, ...row }) => typeof row.value === "number" && Number.isFinite(row.value) ? { ...row, value: row.value } : { ...row, value: 0, pending: valued, converted: 0 });
}
