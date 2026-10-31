import type { ConsentMode, SdkConfig } from "./config";

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 2_048;

// Never assume auto when the server policy could not be resolved.
export async function serverConsent(config: SdkConfig): Promise<ConsentMode | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = new URL(`${config.api}/sdk/config`);
    url.searchParams.set("site", config.site);
    const response = await fetch(url.href, { credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal });
    if (response.status !== 200 || !response.body) { void response.body?.cancel().catch(() => {}); return null; }
    const declared = response.headers.get("Content-Length");
    if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_BYTES) { void response.body.cancel().catch(() => {}); return null; }
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { void reader.cancel().catch(() => {}); return null; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const value = data as Record<string, unknown>;
    return value.site === config.site && (value.consentMode === "auto" || value.consentMode === "require") ? value.consentMode : null;
  } catch {
    return null;
  } finally { clearTimeout(timeout); }
}
