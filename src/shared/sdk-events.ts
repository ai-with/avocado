// 웹 SDK와 수집 서버(/collect)가 공유하는 이벤트 타입. 런타임 코드를 두지 않는다 (SDK 번들에 서버 코드가 섞이지 않게).
// 설계: docs/14-web-sdk-design.md 5-1. 서버 zod 스키마는 src/server/lib/collect/schema.ts.

/** 봉투 스키마 버전. 값이 아니라 타입으로만 둔다. 서버는 현재와 직전 버전을 함께 받는다 (docs/14 9-3) */
export type SdkSchemaVersion = 1;

export type ConsentState = "granted" | "denied" | "pending";

export type UtmKey = "source" | "medium" | "campaign" | "content" | "term";

export interface AttributionTouch {
  clickId: string | null; // avc
  utm: Partial<Record<UtmKey, string>>;
  referrerHost: string | null;
  landingPath: string;
  at: number; // epoch ms
}

export interface StoredAttribution {
  first: AttributionTouch; // 보관 기간 안 처음 터치. 덮어쓰지 않는다
  last: AttributionTouch; // avc 또는 utm이 있는 방문에서만 갱신
  expiresAt: number;
}

export type ViewportBucket = "m" | "t" | "d";

export type ConversionKind = "purchase" | "signup" | "apply" | "custom";

export type TrackProps = Record<string, string | number | boolean>;

export interface SdkEventBase {
  id: string; // 이벤트 ID (중복 제거용, 12자)
  ts: number; // 발생 시각 epoch ms
  url: string; // 쿼리 중 utm_*, avc 외 제거
  ref: string | null;
}

export type PageviewEvent = SdkEventBase & { t: "pageview"; title: string };
export type ScrollEvent = SdkEventBase & { t: "scroll"; depth: 25 | 50 | 75 | 100 };
export type ClickEvent = SdkEventBase & {
  t: "click";
  sel: string;
  text: string;
  href: string | null;
  x: number; // 문서 폭 대비 0~1
  y: number; // 문서 높이 대비 0~1
  vw: ViewportBucket;
  rage?: true;
};
export type FormSubmitEvent = SdkEventBase & { t: "form_submit"; sel: string; fields: number };
export type DwellEvent = SdkEventBase & { t: "dwell"; ms: number }; // 페이지를 떠날 때 1회, 보이는 시간만
export type TrackEvent = SdkEventBase & { t: "track"; name: string; props: TrackProps };
export type ConversionEvent = SdkEventBase & {
  t: "conversion";
  kind: ConversionKind;
  name?: string;
  value?: number;
  currency?: string;
  orderId?: string;
};
export type IdentifyEvent = SdkEventBase & {
  t: "identify";
  email?: string;
  emailHash?: string;
  externalId?: string;
  name?: string;
};

export type SdkEvent =
  | PageviewEvent
  | ScrollEvent
  | ClickEvent
  | FormSubmitEvent
  | DwellEvent
  | TrackEvent
  | ConversionEvent
  | IdentifyEvent;

export type SdkEventType = SdkEvent["t"];

export interface Envelope {
  v: SdkSchemaVersion;
  sdk: string; // SDK 버전, 예 "1.0.0"
  site: string; // site_key (공개 값)
  anon: string; // anon_id. 동의 전 메모리 모드면 페이지마다 새 값
  sess: string; // session_id
  consent: ConsentState;
  attr: { first: AttributionTouch | null; last: AttributionTouch | null };
  screen: { w: number; h: number; dpr: number };
  sentAt: number; // 전송 시각. 서버가 시계 차이 보정에 씀
  events: SdkEvent[]; // 최대 50개
  bot?: true; // navigator.webdriver. 서버가 버린다 (docs/14 6-2 5)
  member?: true; // ?avc_optout=1 로 표시된 브랜드 구성원 브라우저. 서버가 집계에서 뺀다 (docs/14 6-2 6b)
}
