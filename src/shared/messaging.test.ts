import { describe, expect, it } from "vitest";
import { automationSentence, canSend, fillVariables, nightRetryAt, renderEmail, unknownVariables, validateTemplate, type EmailTemplate, type SendableLead } from "./messaging";

// KST 시각을 epoch ms 로. 2026-10-23 기준
const kst = (h: number, m = 0) => Date.UTC(2026, 9, 23, h - 9, m);
const lead = (over: Partial<SendableLead> = {}): SendableLead => ({ email: "a@b.com", phone: null, marketingOptIn: true, alimtalkOptIn: false, unsubscribedAt: null, bouncedAt: null, ...over });
const tpl = (over: Partial<EmailTemplate> = {}): EmailTemplate => ({ subject: "{{이름}}님 신청 확인", preview: "", body: "{{가이드명}} 자료예요", buttonLabel: "", buttonUrl: "", ...over });

describe("canSend", () => {
  it("정보성은 낮에도 밤에도 보낸다", () => {
    expect(canSend(lead({ marketingOptIn: false }), "email", "info", kst(23))).toEqual({ ok: true });
  });
  it("광고성은 마케팅 동의가 없으면 수신 동의 없음", () => {
    expect(canSend(lead({ marketingOptIn: false }), "email", "ad", kst(12))).toEqual({ ok: false, reason: "no_consent" });
  });
  it("광고성 야간(21:00~08:00 KST)은 다음 08:00 로 보류", () => {
    expect(canSend(lead(), "email", "ad", kst(12))).toEqual({ ok: true });
    expect(canSend(lead(), "email", "ad", kst(20, 59))).toEqual({ ok: true });
    expect(canSend(lead(), "email", "ad", kst(21))).toEqual({ ok: false, reason: "night", retryAt: Date.UTC(2026, 9, 24, -1) });
    expect(canSend(lead(), "email", "ad", kst(7, 59))).toEqual({ ok: false, reason: "night", retryAt: kst(8) });
    expect(nightRetryAt(kst(8))).toBeNull();
  });
  it("수신 거부·반송은 정보성도 제외", () => {
    expect(canSend(lead({ unsubscribedAt: 1 }), "email", "info", kst(12))).toEqual({ ok: false, reason: "unsubscribed" });
    expect(canSend(lead({ bouncedAt: 1 }), "email", "info", kst(12))).toEqual({ ok: false, reason: "bounced" });
  });
  it("알림톡은 전화번호, 알림톡 동의, 채널 연결이 모두 필요", () => {
    expect(canSend(lead(), "alimtalk", "info", kst(12), true)).toEqual({ ok: false, reason: "no_phone" });
    expect(canSend(lead({ phone: "010" }), "alimtalk", "info", kst(12), true)).toEqual({ ok: false, reason: "no_alimtalk_consent" });
    expect(canSend(lead({ phone: "010", alimtalkOptIn: true }), "alimtalk", "info", kst(12), false)).toEqual({ ok: false, reason: "alimtalk_not_connected" });
    expect(canSend(lead({ phone: "010", alimtalkOptIn: true }), "alimtalk", "info", kst(12), true)).toEqual({ ok: true });
  });
});

describe("변수 치환과 렌더", () => {
  it("지원 변수만 치환하고 빈 이름은 고객", () => {
    expect(fillVariables("{{이름}}님, {{ 가이드명 }} / {{인플루언서명}} {{쿠폰}}", { 이름: null, 가이드명: "봄 가이드", 인플루언서명: "제이" })).toBe("고객님, 봄 가이드 / 제이 {{쿠폰}}");
    expect(unknownVariables("{{이름}} {{쿠폰}}", "{{쿠폰}} {{등급}}")).toEqual(["쿠폰", "등급"]);
  });
  it("광고성은 제목 앞 (광고), 성격과 상관없이 전송자와 수신 거부 링크", () => {
    const o = { senderName: "아보카도", senderContact: "help@x.com", unsubscribeUrl: "https://app/unsubscribe/T" };
    const ad = renderEmail(tpl(), { 이름: "민수", 가이드명: "<봄>" }, { kind: "ad", ...o });
    expect(ad.subject).toBe("(광고) 민수님 신청 확인");
    expect(ad.html).toContain("&#60;봄&#62; 자료예요");
    expect(ad.html).toContain("https://app/unsubscribe/T");
    expect(ad.text).toContain("보낸 곳: 아보카도 · help@x.com");
    const info = renderEmail(tpl(), { 이름: "민수" }, { kind: "info", ...o });
    expect(info.subject).toBe("민수님 신청 확인");
    expect(info.text).toContain("수신 거부: https://app/unsubscribe/T");
  });
});

describe("validateTemplate", () => {
  const base = { channel: "email" as const, kind: "info" as const, hasTarget: true, alimtalkConnected: false, senderReady: true };
  const failed = (i: Parameters<typeof validateTemplate>[0]) => validateTemplate(i).filter((c) => !c.ok).map((c) => c.key);
  it("다 채우면 통과", () => expect(failed({ ...base, template: tpl() })).toEqual([]));
  it("제목·본문 필수, 지원 안 하는 변수, 대상", () => {
    expect(failed({ ...base, template: tpl({ subject: " ", body: "" }) })).toEqual(["subject", "body"]);
    expect(failed({ ...base, template: tpl({ body: "{{쿠폰}}" }) })).toEqual(["variables"]);
    expect(failed({ ...base, hasTarget: false, template: tpl() })).toEqual(["target"]);
  });
  it("버튼은 이름과 http(s) 링크를 함께", () => {
    expect(failed({ ...base, template: tpl({ buttonLabel: "보기", buttonUrl: "example.com" }) })).toEqual(["button"]);
    expect(failed({ ...base, template: tpl({ buttonLabel: "", buttonUrl: "https://example.com" }) })).toEqual(["button"]);
    expect(failed({ ...base, template: tpl({ buttonLabel: "보기", buttonUrl: "https://example.com/a" }) })).toEqual([]);
  });
  it("알림톡은 채널 미연결이면 실패, 광고성 불가", () => {
    expect(failed({ ...base, channel: "alimtalk", template: { templateCode: "T1", variables: {} } })).toEqual(["channel"]);
    expect(failed({ ...base, channel: "alimtalk", kind: "ad", alimtalkConnected: true, template: { templateCode: "T1", variables: {} } })).toEqual(["channel"]);
  });
});

it("설정 문장", () => {
  expect(automationSentence("form_submitted", "체험 신청", 0, "email")).toBe("누군가 [체험 신청]을 제출하면 → 즉시 → 이메일을 보내요");
});
