import { afterEach, describe, expect, it, vi } from "vitest";
import { sendSms } from "./sms";

const env = { SMS_PROVIDER: "solapi", SOLAPI_API_KEY: "KEY", SOLAPI_API_SECRET: "SECRET", SMS_FROM: "02-123-4567" } as Env;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function mockFetch(res: Response) {
  const fn = vi.fn().mockResolvedValue(res);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("sendSms", () => {
  it("설정이 없으면 no_provider", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await sendSms({} as Env, "+821012345678", "hi")).toEqual({ delivered: false, reason: "no_provider" });
  });

  it("no_provider 로그: 운영이면 본문(인증번호) 없음", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await sendSms({ APP_ENV: "production" } as Env, "+821012345678", "인증번호 987654");
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("[sms:no_provider]");
    expect(logged).not.toContain("987654");
  });

  it("no_provider 로그: 개발이면 본문 포함", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await sendSms({ APP_ENV: "development" } as Env, "+821012345678", "인증번호 987654");
    expect(JSON.stringify(log.mock.calls)).toContain("987654");
  });

  it("성공: send-many/detail 요청 모양과 delivered", async () => {
    const fn = mockFetch(json({ failedMessageList: [] }));
    expect(await sendSms(env, "+821012345678", "hi")).toEqual({ delivered: true });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.solapi.com/messages/v4/send-many/detail");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^HMAC-SHA256 apiKey=KEY, date=\d{4}-.+Z, salt=[0-9a-f]{32}, signature=[0-9a-f]{64}$/);
    expect(JSON.parse(init.body as string)).toEqual({ messages: [{ to: "01012345678", from: "021234567", text: "hi" }] });
  });

  it("failedMessageList에 1건이면 provider_error, 로그에 번호 원문 없음", async () => {
    mockFetch(json({ failedMessageList: [{ to: "01012345678", statusCode: "1030", statusMessage: "잔액 부족" }] }));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await sendSms(env, "+821012345678", "hi")).toEqual({ delivered: false, reason: "provider_error" });
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain("1030");
    expect(logged).not.toContain("01012345678");
    expect(logged).not.toContain("SECRET");
  });

  it("HTTP 500이면 provider_error", async () => {
    mockFetch(json({ errorCode: "InvalidApiKey", errorMessage: "bad key" }, 500));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await sendSms(env, "+821012345678", "hi")).toEqual({ delivered: false, reason: "provider_error" });
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain("InvalidApiKey");
    expect(logged).not.toContain("01012345678");
  });

  it("JSON 파싱 실패면 provider_error", async () => {
    mockFetch(new Response("not json", { status: 200 }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await sendSms(env, "+821012345678", "hi")).toEqual({ delivered: false, reason: "provider_error" });
  });

  it("오류 로그의 지문은 같은 키에 일치하고 다른 키와 구별되며 비밀 원문을 포함하지 않는다", async () => {
    const configured = { ...env, APP_ENV: "production", SOLAPI_API_KEY: "fake-solapi-key-for-fingerprint", SOLAPI_API_SECRET: "fake-secret-for-log-test" } as Env;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const signatures: string[] = [];
    for (const response of [
      json({ errorCode: "Forbidden", errorMessage: "허용되지 않은 IP로 접근" }, 403),
      json({ failedMessageList: [{ to: "01000000000", statusCode: "1030", statusMessage: "발송 실패", text: "인증번호 654321" }] }),
      new Response("invalid json", { status: 200 }),
    ]) {
      const fetcher = mockFetch(response);
      expect(await sendSms(configured, "+821000000000", "인증번호 654321")).toEqual({ delivered: false, reason: "provider_error" });
      const init = fetcher.mock.calls[0]![1] as RequestInit;
      signatures.push((init.headers as Record<string, string>).Authorization!.match(/signature=([0-9a-f]{64})/)![1]!);
    }
    mockFetch(json({ errorCode: "Forbidden" }, 403));
    await sendSms({ ...configured, SOLAPI_API_KEY: "another-fake-solapi-key" }, "+821000000000", "인증번호 654321");
    const records = err.mock.calls.map(([label, value]) => {
      expect(label).toBe("[sms:provider_error]");
      return JSON.parse(String(value)) as { key_fingerprint: string; status: number };
    });
    // 합성 fixture 키에 대한 알려진 SHA-256 앞 12자리. 발송 방식·응답은 바꾸지 않는다.
    expect(records.map((record) => record.key_fingerprint)).toEqual(["992730875885", "992730875885", "992730875885", "362109d0b606"]);
    expect(records[0]?.status).toBe(403);
    const logged = JSON.stringify(err.mock.calls);
    for (const value of [configured.SOLAPI_API_KEY!, configured.SOLAPI_API_SECRET!, "another-fake-solapi-key", "+821000000000", "01000000000", "654321", ...signatures]) expect(logged).not.toContain(value);
  });

  it("성공과 제공자 미설정 경로에서는 키 지문을 계산하지 않는다", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockFetch(json({ failedMessageList: [] }));
    expect(await sendSms(env, "+821000000000", "합성 테스트 메시지")).toEqual({ delivered: true });
    expect(await sendSms({ APP_ENV: "production" } as Env, "+821000000000", "합성 테스트 메시지")).toEqual({ delivered: false, reason: "no_provider" });
    expect(digest).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
