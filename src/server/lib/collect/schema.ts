import { z } from "zod";
import type { Envelope, SdkEvent } from "../../../shared/sdk-events";

// /collect 봉투 검증 (docs/14 5-1). SDK 에는 zod 를 넣지 않으므로 서버만 이 스키마를 쓴다

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_EVENTS = 50;
const MAX_URL = 2000;
const MAX_SEL = 300;
const MAX_TEXT = 80;
const MAX_TRACK_NAME = 64;
const MAX_PROPS = 20;
const MAX_PROP_VALUE = 200;
const MAX_ID = 100;

const clip = (max: number) => z.string().transform((s) => s.slice(0, max));
const id = z.string().min(8).max(40);
const epoch = z.number().int().nonnegative();
const utmSchema = z.partialRecord(z.enum(["source", "medium", "campaign", "content", "term"]), clip(MAX_ID));
const touchSchema = z.object({ clickId: z.string().max(40).nullable(), utm: utmSchema, referrerHost: clip(253).nullable(), landingPath: clip(MAX_URL), at: epoch });

const base = { id, ts: epoch, url: clip(MAX_URL), ref: clip(MAX_URL).nullable() };
// 키 20개를 넘는 props 는 앞 20개만 남기고 문자열 값은 200자로 자른다
const propsSchema = z.record(z.string().max(MAX_TRACK_NAME), z.union([clip(MAX_PROP_VALUE), z.number(), z.boolean()])).transform((p) => Object.fromEntries(Object.entries(p).slice(0, MAX_PROPS)));

export const eventSchema = z.discriminatedUnion("t", [
  z.object({ ...base, t: z.literal("pageview"), title: clip(MAX_ID * 2) }),
  z.object({ ...base, t: z.literal("scroll"), depth: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(100)]) }),
  z.object({
    ...base,
    t: z.literal("click"),
    sel: clip(MAX_SEL),
    text: clip(MAX_TEXT),
    href: clip(MAX_URL).nullable(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    vw: z.enum(["m", "t", "d"]),
    rage: z.literal(true).optional(),
  }),
  z.object({ ...base, t: z.literal("form_submit"), sel: clip(MAX_SEL), fields: z.number().int().nonnegative() }),
  z.object({ ...base, t: z.literal("dwell"), ms: z.number().int().nonnegative() }),
  z.object({ ...base, t: z.literal("track"), name: z.string().min(1).max(MAX_TRACK_NAME), props: propsSchema }),
  z.object({
    ...base,
    t: z.literal("conversion"),
    kind: z.enum(["purchase", "signup", "apply", "custom"]),
    name: clip(MAX_TRACK_NAME).optional(),
    value: z.number().finite().optional(),
    currency: z.string().regex(/^[A-Za-z]{3}$/).transform((s) => s.toUpperCase()).optional(),
    orderId: z.string().min(1).max(MAX_ID).optional(),
  }),
  z.object({
    ...base,
    t: z.literal("identify"),
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()).optional(),
    emailHash: z.string().regex(/^[0-9a-f]{64}$/i).transform((s) => s.toLowerCase()).optional(),
    externalId: z.string().min(1).max(MAX_ID).optional(),
    name: clip(MAX_ID).optional(),
  }),
]);

// 모르는 t 나 형식이 틀린 이벤트는 그 이벤트만 버린다(앞으로 호환, docs/14 9-3). 50개 초과분도 버린다
const eventsSchema = z.array(z.unknown()).transform((raw): SdkEvent[] =>
  raw.slice(0, MAX_EVENTS).flatMap((e) => {
    const r = eventSchema.safeParse(e);
    return r.success ? [r.data] : [];
  }),
);

export const envelopeSchema = z.object({
  v: z.literal(1),
  sdk: z.string().max(20),
  site: z.string().min(1).max(40),
  anon: id,
  sess: id,
  consent: z.enum(["granted", "denied", "pending"]),
  attr: z.object({ first: touchSchema.nullable(), last: touchSchema.nullable() }),
  screen: z.object({ w: z.number().nonnegative(), h: z.number().nonnegative(), dpr: z.number().positive() }),
  sentAt: epoch,
  events: eventsSchema,
  bot: z.literal(true).optional(),
  member: z.literal(true).optional(),
});

// 공유 타입과 어긋나면 여기서 컴파일 오류가 난다
export type ParsedEnvelope = z.infer<typeof envelopeSchema>;
const sameEnvelope: (e: ParsedEnvelope) => Envelope = (e) => e;
const sameEvent: (e: z.infer<typeof eventSchema>) => SdkEvent = (e) => e;
void sameEnvelope;
void sameEvent;

export function parseEnvelope(text: string): Envelope | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const r = envelopeSchema.safeParse(json);
  return r.success ? r.data : null;
}
