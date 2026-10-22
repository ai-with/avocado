import type { ConsentState } from "../../src/shared/sdk-events";

declare const __SDK_VERSION__: string;
export const SDK_VERSION: string = __SDK_VERSION__;

export const BATCH_SIZE = 20;
export const FLUSH_INTERVAL_MS = 5_000;
export const RETRY_DELAYS_MS = [2_000, 8_000, 30_000];
export const MAX_EVENTS_PER_ENVELOPE = 50;
// sendBeacon 대기열 한도 64KiB 안에 들어가게 여유를 둔다 (docs/14 5-1)
export const MAX_BODY_BYTES = 60 * 1024;
export const OFFLINE_MAX_EVENTS = 200;
export const OFFLINE_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const ANON_ID_DAYS = 365;
export const DEFAULT_ATTRIBUTION_DAYS = 30;
export const SCROLL_DEPTHS = [25, 50, 75, 100] as const;
export type ScrollDepth = (typeof SCROLL_DEPTHS)[number];

export const KEY_ATTR = "avc_attr";
export const KEY_QUEUE = "avc_q";
export const KEY_ID = "avc_id";
export const KEY_OPT_OUT = "avc_off";
export const KEY_MEMBER = "avc_member";

/** 사이트 동의 모드 require: 동의 전에는 메모리 모드로도 보내지 않는다 (docs/14 7장) */
export type ConsentOption = ConsentState | "require";

export interface SdkConfig {
  site: string;
  api: string;
  autocapture: boolean;
  consent: ConsentOption | null;
  scrollThresholds: ScrollDepth[];
  sampleRate: number;
  cookieDomain: string | null;
  hashEmail: boolean;
  attributionDays: number;
}

export type InitOptions = Partial<Omit<SdkConfig, "site" | "api">>;

const CONSENT_OPTIONS: readonly string[] = ["granted", "denied", "pending", "require"];

export function parseConsent(value: string | null | undefined): ConsentOption | null {
  return value && CONSENT_OPTIONS.includes(value) ? (value as ConsentOption) : null;
}

export function parseThresholds(value: string | readonly number[] | null | undefined): ScrollDepth[] {
  if (value == null) return [...SCROLL_DEPTHS];
  const numbers = typeof value === "string" ? value.split(",").map(Number) : value;
  return SCROLL_DEPTHS.filter((depth) => numbers.includes(depth));
}

function scriptOrigin(script: HTMLScriptElement | null): string {
  try {
    return script?.src ? new URL(script.src).origin : location.origin;
  } catch {
    return location.origin;
  }
}

/** 설치 스크립트 태그의 data-* 속성을 읽는다. 서버 설정은 받지 않는다 (요청 1회 절약, docs/14 8-1) */
export function readScriptConfig(script: HTMLScriptElement | null): SdkConfig {
  const data = script?.dataset ?? {};
  const days = Number(data.attributionDays);
  return {
    site: data.site ?? "",
    api: (data.api ?? scriptOrigin(script)).replace(/\/+$/, ""),
    autocapture: data.autocapture !== "false",
    consent: parseConsent(data.consent),
    scrollThresholds: parseThresholds(data.scroll),
    sampleRate: 1,
    cookieDomain: data.cookieDomain ?? null,
    hashEmail: data.hashEmail !== "false",
    attributionDays: days >= 1 && days <= 90 ? days : DEFAULT_ATTRIBUTION_DAYS,
  };
}

export function applyInit(config: SdkConfig, options: InitOptions): SdkConfig {
  const next: SdkConfig = { ...config, ...options };
  next.scrollThresholds = parseThresholds(options.scrollThresholds ?? config.scrollThresholds);
  next.sampleRate = Math.min(1, Math.max(0, Number(next.sampleRate)));
  return next;
}

export function findInstallScript(doc: Document): HTMLScriptElement | null {
  const current = doc.currentScript;
  if (current instanceof HTMLScriptElement && current.dataset.site) return current;
  return doc.querySelector<HTMLScriptElement>("script[data-site]");
}
