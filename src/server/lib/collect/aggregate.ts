import type { ConversionEvent, Envelope, IdentifyEvent, SdkEvent } from "../../../shared/sdk-events";

// 봉투 하나를 세션 증분으로 줄이는 순수 함수들 (docs/14 6-3). DB 는 consume.ts 가 다룬다

export const SCROLL_STEPS = [25, 50, 75, 100] as const;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type SessionDelta = {
  firstAt: number;
  lastAt: number;
  pageviews: number;
  maxScroll: number;
  visibleMs: number;
  clicks: number;
  conversions: ConversionEvent[];
  identifies: IdentifyEvent[];
};

// 한국 시간 기준 일자 (YYYY-MM-DD)
export const kstDay = (at: number) => new Date(at + KST_OFFSET_MS).toISOString().slice(0, 10);

// 브라우저 시계 차이 보정. 서버 수신 시각보다 미래로 가지 않게 자른다
export function correctedTs(ts: number, env: Pick<Envelope, "sentAt">, receivedAt: number): number {
  return Math.min(ts + (receivedAt - env.sentAt), receivedAt);
}

function addEvent(d: SessionDelta, e: SdkEvent) {
  if (e.t === "pageview") d.pageviews += 1;
  else if (e.t === "scroll") d.maxScroll = Math.max(d.maxScroll, e.depth);
  else if (e.t === "dwell") d.visibleMs += e.ms;
  else if (e.t === "click") d.clicks += 1;
  else if (e.t === "conversion") d.conversions.push(e);
  else if (e.t === "identify") d.identifies.push(e);
}

// seen 에 든 이벤트 ID 는 이미 처리한 것(중복 전송)이라 뺀다
export function sessionDelta(env: Envelope, receivedAt: number, seen: Set<string>): SessionDelta | null {
  const events = env.events.filter((e) => !seen.has(e.id));
  if (events.length === 0) return null;
  const times = events.map((e) => correctedTs(e.ts, env, receivedAt));
  const d: SessionDelta = { firstAt: Math.min(...times), lastAt: Math.max(...times), pageviews: 0, maxScroll: 0, visibleMs: 0, clicks: 0, conversions: [], identifies: [] };
  for (const e of events) addEvent(d, e);
  return d;
}

// 이전 최대 스크롤에서 새로 넘은 단계만 센다 (세션당 단계별 1회)
export function newScrollSteps(prevMax: number, nextMax: number): number[] {
  return SCROLL_STEPS.filter((s) => prevMax < s && nextMax >= s);
}

// 해시 매칭 규칙. SDK 의 hashEmail 과 같아야 한다
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export type DailyDelta = { sessions: number; pageviews: number; scroll: number[]; conversions: number; conversionValue: number; membersExcluded: number };

// 일별 집계 증분. prevMax 가 null 이면 새 세션. 구성원 세션은 숫자에 넣지 않고 제외 수만 센다(내 조회 제외)
// conversions 는 주문 번호 중복을 이미 뺀 목록. 금액은 사이트 기본 통화인 것만 더한다
export function dailyDelta(d: SessionDelta, conversions: ConversionEvent[], prevMax: number | null, isMember: boolean, currency: string): DailyDelta {
  const isNew = prevMax === null;
  if (isMember) return { sessions: 0, pageviews: 0, scroll: [], conversions: 0, conversionValue: 0, membersExcluded: isNew ? 1 : 0 };
  const value = conversions.reduce((sum, c) => sum + ((c.currency ?? currency) === currency ? (c.value ?? 0) : 0), 0);
  return {
    sessions: isNew ? 1 : 0,
    pageviews: d.pageviews,
    scroll: newScrollSteps(prevMax ?? 0, d.maxScroll),
    conversions: conversions.length,
    // The currency ledger keeps explicit unpriced coverage. Do not send
    // Infinity/NaN through D1's JSON binding for this legacy cached field.
    conversionValue: Number.isFinite(value) ? value : 0,
    membersExcluded: 0,
  };
}
