import { KEY_ID, SESSION_IDLE_MS } from "./config";
import type { SdkStorage } from "./storage";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const EVENT_ID_LENGTH = 12;
const ANON_ID_LENGTH = 16;
const SESSION_ID_LENGTH = 16;

export function randomId(length: number = EVENT_ID_LENGTH): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = "";
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length];
  return id;
}

interface IdentityRecord {
  a: string; // 익명 ID
  s: string; // 세션 ID
  t: number; // 마지막 활동 시각
  k: boolean; // 이 세션이 표본에 들었는지 (sampleRate)
}

export interface Identity {
  anon: string;
  session: string;
  sampled: boolean;
}

function readRecord(storage: SdkStorage): IdentityRecord | null {
  const parsed = storage.getJson<IdentityRecord>(KEY_ID);
  return parsed && typeof parsed.a === "string" && typeof parsed.s === "string" ? parsed : null;
}

/** 이벤트마다 부른다. 30분 넘게 활동이 없으면 세션을 새로 만든다 */
export function touchIdentity(storage: SdkStorage, sampleRate: number, now: number): Identity {
  const record = readRecord(storage);
  const next: IdentityRecord =
    record && now - record.t < SESSION_IDLE_MS
      ? { ...record, t: now }
      : { a: record?.a ?? randomId(ANON_ID_LENGTH), s: randomId(SESSION_ID_LENGTH), t: now, k: Math.random() < sampleRate };
  storage.setJson(KEY_ID, next);
  return { anon: next.a, session: next.s, sampled: next.k };
}

/** 로그아웃 시: 익명 ID와 세션을 새로 */
export function resetIdentity(storage: SdkStorage): void {
  storage.remove(KEY_ID);
}
