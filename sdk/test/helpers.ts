import { vi } from "vitest";
import type { Envelope, SdkEvent } from "../../src/shared/sdk-events";
import { DEFAULT_ATTRIBUTION_DAYS, SCROLL_DEPTHS, type SdkConfig } from "../src/config";

export function makeConfig(overrides: Partial<SdkConfig> = {}): SdkConfig {
  return {
    site: "site_test",
    api: "https://app.test",
    autocapture: true,
    consent: null,
    scrollThresholds: [...SCROLL_DEPTHS],
    sampleRate: 1,
    cookieDomain: null,
    hashEmail: true,
    attributionDays: DEFAULT_ATTRIBUTION_DAYS,
    ...overrides,
  };
}

/** fetch를 가짜로 바꾸고 보낸 봉투를 모은다 */
export function stubFetch(status = 204): { envelopes: Envelope[]; fetchMock: ReturnType<typeof vi.fn> } {
  const envelopes: Envelope[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    envelopes.push(JSON.parse(String(init.body)) as Envelope);
    return new Response(null, { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { envelopes, fetchMock };
}

export function sentEvents(envelopes: Envelope[]): SdkEvent[] {
  return envelopes.flatMap((envelope) => envelope.events);
}

export function setDocumentSize(width: number, height: number): void {
  Object.defineProperty(document.documentElement, "scrollWidth", { configurable: true, value: width });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: height });
}

export function resetBrowserState(path = "/"): void {
  localStorage.clear();
  for (const part of document.cookie.split("; ")) {
    const name = part.split("=")[0];
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
  history.replaceState(null, "", path);
  document.body.innerHTML = "";
}
