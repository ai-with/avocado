import { Hono, type Context } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import type { AppEnv } from "../types";
import { sites } from "../db/schema";
import { now } from "../lib/ids";
import { deviceOf, isBotUA } from "../lib/links";
import { MAX_BODY_BYTES, parseEnvelope } from "../lib/collect/schema";
import { hostAllowed, hostOf } from "../lib/collect/origin";
import { stageCollectIntake } from "../lib/collect/intake";
import type { CollectMessage } from "../lib/collect/consume";
import type { Envelope } from "../../shared/sdk-events";

// POST /collect: 웹 SDK 수집 (docs/14 6-2). 응답 본문은 없다. 거절도 상태 코드만 준다

type Site = typeof sites.$inferSelect;
const CORS_MAX_AGE_S = 86400;

function corsHeaders(origin: string): Record<string, string> {
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": String(CORS_MAX_AGE_S), Vary: "Origin" };
}

// 봇·거부·동의 필요 사이트의 미동의는 받되 버린다(재시도하지 않게 204)
export function shouldDrop(env: Envelope, site: Pick<Site, "consentMode">, ua: string | undefined): boolean {
  if (env.bot || isBotUA(ua)) return true;
  if (env.consent === "denied") return true;
  return site.consentMode === "require" && env.consent !== "granted";
}

async function readBody(c: Context<AppEnv>): Promise<string | null> {
  if (Number(c.req.header("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  const reader = c.req.raw.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes); } catch { return ""; }
}

export function freezeConversionCurrency(envelope: Envelope, currency: string): Envelope {
  return { ...envelope, events: envelope.events.map((event) => event.t === "conversion" && event.currency === undefined ? { ...event, currency } : event) };
}

async function enqueue(c: Context<AppEnv>, site: Site, incoming: Envelope) {
  // Freeze the accepted source unit before site settings can change in Queue.
  const envelope = freezeConversionCurrency(incoming, site.currency);
  const ua = c.req.header("user-agent");
  const payload: CollectMessage = {
    siteId: site.id,
    workspaceId: site.workspaceId,
    receivedAt: now(),
    country: (c.req.raw.cf?.country as string | undefined) ?? null,
    device: deviceOf(ua),
    envelope,
  };
  const id = await stageCollectIntake(c.env, payload);
  if (id) {
    try { await c.env.COLLECT.send({ type: "collect", payload: { id } }); }
    catch { throw new Error("sdk_intake_enqueue_failed"); }
  }
}

export const collectRoutes = new Hono<AppEnv>()
  .options("/", (c) => {
    const origin = c.req.header("origin");
    return c.body(null, 204, origin ? corsHeaders(origin) : {});
  })
  .post("/", async (c) => {
    const text = await readBody(c);
    if (text === null) return c.body(null, 413);
    const envelope = parseEnvelope(text);
    if (!envelope) return c.body(null, 400);
    const site = await c.var.db.select().from(sites).where(and(eq(sites.siteKey, envelope.site), isNull(sites.deletedAt))).get();
    if (!site) return c.body(null, 404);
    // site_key 는 공개 값이라 Origin 허용 도메인이 1차 방어다
    const origin = c.req.header("origin");
    const host = hostOf(origin);
    if (!origin || !host || !hostAllowed(host, site.allowedDomains)) return c.body(null, 403);
    if (!shouldDrop(envelope, site, c.req.header("user-agent")) && envelope.events.length > 0) await enqueue(c, site, envelope);
    return c.body(null, 204, corsHeaders(origin));
  });
