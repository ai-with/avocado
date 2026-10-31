import { afterEach, describe, expect, it, vi } from "vitest";
import { sendSms } from "./sms";

const env = { SMS_PROVIDER: "solapi", SOLAPI_API_KEY: "KEY", SOLAPI_API_SECRET: "SECRET", SMS_FROM: "02-123-4567" } as Env;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function mockFetch(res: Response) {
  const fn = vi.fn().mockResolvedValue(res);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => vi.restoreAllMocks());

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
});
