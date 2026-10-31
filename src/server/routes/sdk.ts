import { Hono } from "hono";
import type { AppEnv } from "../types";
import manifest from "../../../sdk/releases/manifest.json";
import { hostAllowed, hostOf } from "../lib/collect/origin";

type Release = { bytes: number; sha256: string; integrity: string };
const files: Record<string, Release> = manifest.files;
const latest: Record<string, string> = manifest.latest;
const PINNED = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(js|mjs)$/;
const ALIAS = /^v(0|[1-9]\d*)\.js$/;
const PREFIX = "sdk-releases/";
const unavailable = () => new Response(null, { status: 503, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });

async function validBytes(bytes: ArrayBuffer, expected: Release): Promise<boolean> {
  if (bytes.byteLength !== expected.bytes) return false;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("") === expected.sha256;
}

async function objectBytes(object: R2ObjectBody, expected: Release): Promise<ArrayBuffer | null> {
  if (object.size !== expected.bytes) { void object.body.cancel().catch(() => {}); return null; }
  const bytes = await object.arrayBuffer();
  return await validBytes(bytes, expected) ? bytes : null;
}

// Only trusted bundled, manifest-verified releases may be archived. A racing writer
// must win a conditional create; neither an existing object nor a mismatch is replaced.
async function releaseBytes(env: Env, request: Request, name: string, expected: Release): Promise<ArrayBuffer | null> {
  const key = PREFIX + name;
  const existing = await env.FILES.get(key);
  if (existing) return objectBytes(existing, expected);
  const response = await env.ASSETS.fetch(new Request(new URL(`/sdk/${name}`, request.url), { method: "GET", redirect: "manual" }));
  if (response.status !== 200 || !response.body) { void response.body?.cancel().catch(() => {}); return null; }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expected.bytes) { void reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (!await validBytes(bytes.buffer, expected)) return null;
  const created = await env.FILES.put(key, bytes, {
    onlyIf: new Headers({ "If-None-Match": "*" }),
    httpMetadata: { contentType: "application/javascript; charset=utf-8", cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { sha256: expected.sha256, integrity: expected.integrity },
  });
  if (created) return bytes.buffer;
  const winner = await env.FILES.get(key);
  return winner ? objectBytes(winner, expected) : null;
}

export const sdkRoutes = new Hono<AppEnv>()
  .get("/config", async (c) => {
    const origin = c.req.header("origin"), host = hostOf(origin), key = c.req.query("site");
    const headers = { "Cache-Control": "no-store", Vary: "Origin" };
    if (!origin || !host) return c.body(null, 403, headers);
    if (!key || key.length > 100) return c.body(null, 400, headers);
    const site = await c.env.DB.prepare("SELECT site_key AS siteKey, allowed_domains AS domains, consent_mode AS consentMode FROM sites WHERE site_key=? AND deleted_at IS NULL")
      .bind(key).first<{ siteKey: string; domains: string; consentMode: string }>();
    if (!site) return c.body(null, 404, headers);
    let domains: unknown;
    try { domains = JSON.parse(site.domains); } catch { return c.body(null, 503, headers); }
    if (!Array.isArray(domains) || !domains.every((domain) => typeof domain === "string") || !hostAllowed(host, domains)) return c.body(null, 403, headers);
    if (site.consentMode !== "auto" && site.consentMode !== "require") return c.body(null, 503, headers);
    return c.json({ site: site.siteKey, consentMode: site.consentMode }, 200, { ...headers, "Access-Control-Allow-Origin": origin });
  })
  .on(["GET", "HEAD"], "/:file", async (c) => {
    const requested = c.req.param("file"), alias = ALIAS.exec(requested);
    const name = alias && latest[alias[1]!] ? `v${latest[alias[1]!]}.js` : requested;
    const expected = PINNED.test(name) ? files[name] : undefined;
    if (!expected) return c.body(null, 404, { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    try {
      const bytes = await releaseBytes(c.env, c.req.raw, name, expected);
      if (!bytes) return unavailable();
      const etag = `"${expected.sha256}"`;
      const headers = {
        "Content-Type": "application/javascript; charset=utf-8", "Content-Length": String(expected.bytes), "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*", "Cache-Control": alias ? "public, max-age=0, must-revalidate" : "public, max-age=31536000, immutable", ETag: etag,
      };
      if (c.req.header("if-none-match")?.split(",").some((value) => value.trim() === etag || value.trim() === "*")) return new Response(null, { status: 304, headers });
      return new Response(c.req.method === "HEAD" ? null : bytes, { headers });
    } catch {
      return unavailable();
    }
  });
