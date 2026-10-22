import type { ConversionKind, TrackProps } from "../../src/shared/sdk-events";
import type { EventInput } from "./types";

// 서버도 같은 한도로 자르거나 거절한다 (docs/14 5-1 제약)
const MAX_NAME_LENGTH = 64;
const MAX_PROP_KEYS = 20;
const MAX_STRING_LENGTH = 200;
const MAX_ID_LENGTH = 100;
const CONVERSION_KINDS: readonly ConversionKind[] = ["purchase", "signup", "apply", "custom"];
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

export interface ConversionInput {
  type?: string;
  name?: string;
  value?: number;
  currency?: string;
  orderId?: string;
}

export interface IdentifyInput {
  email?: string;
  externalId?: string;
  name?: string;
}

function isPlainValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

export function sanitizeProps(props: unknown): TrackProps {
  const result: TrackProps = {};
  if (!props || typeof props !== "object") return result;
  let count = 0;
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (count >= MAX_PROP_KEYS) break;
    if (!isPlainValue(value)) continue;
    result[key.slice(0, MAX_NAME_LENGTH)] = typeof value === "string" ? value.slice(0, MAX_STRING_LENGTH) : value;
    count++;
  }
  return result;
}

export function trackEvent(name: unknown, props: unknown): EventInput | null {
  if (typeof name !== "string" || !name.trim()) return null;
  return { t: "track", name: name.trim().slice(0, MAX_NAME_LENGTH), props: sanitizeProps(props) };
}

/** 통화가 없으면 서버가 사이트 기본 통화(기본 KRW)를 쓴다 */
export function conversionEvent(input: ConversionInput | undefined): EventInput {
  const source = input ?? {};
  const kind = CONVERSION_KINDS.find((candidate) => candidate === source.type) ?? "custom";
  const event: EventInput = { t: "conversion", kind };
  if (typeof source.name === "string") event.name = source.name.slice(0, MAX_NAME_LENGTH);
  if (typeof source.value === "number" && Number.isFinite(source.value)) event.value = source.value;
  if (typeof source.currency === "string" && CURRENCY_PATTERN.test(source.currency)) {
    event.currency = source.currency.toUpperCase();
  }
  if (source.orderId != null && source.orderId !== "") event.orderId = String(source.orderId).slice(0, MAX_ID_LENGTH);
  return event;
}

const encoder = new TextEncoder();

/** 소문자·공백 제거 후 SHA-256 16진수. 서버 leads.email_hash와 같은 규칙 (docs/14 4-4) */
export async function hashEmail(email: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(email.trim().toLowerCase()));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 기본은 브라우저에서 해시만 보낸다. 해시를 못 만들면 원문을 대신 보내지 않는다 */
export async function identifyEvent(input: IdentifyInput | undefined, sendHash: boolean): Promise<EventInput | null> {
  const source = input ?? {};
  const event: EventInput = { t: "identify" };
  if (typeof source.email === "string" && source.email.includes("@")) {
    const hash = sendHash ? await hashEmail(source.email) : null;
    if (hash) event.emailHash = hash;
    else if (!sendHash) event.email = source.email.trim();
  }
  if (typeof source.externalId === "string" && source.externalId) {
    event.externalId = source.externalId.slice(0, MAX_ID_LENGTH);
  }
  if (typeof source.name === "string" && source.name) event.name = source.name.slice(0, MAX_ID_LENGTH);
  return event.email || event.emailHash || event.externalId ? event : null;
}
