import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "./ids";
import { publicJoinChallenge, turnstileConfigured, verifyPublicJoin } from "./turnstile";

const GUIDE = "guide-one";
const REQUEST_URL = "https://request.example.com/g/guide-one/join";
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TEST_SITE_KEYS = ["1x00000000000000000000AA", "2x00000000000000000000AB", "1x00000000000000000000BB", "2x00000000000000000000BB", "3x00000000000000000000FF"];
const TEST_SECRET_KEYS = ["1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"];
const env = (overrides: Partial<Env> = {}) => ({ APP_ENV: "production", APP_URL: "https://app.example.com", TURNSTILE_SITE_KEY: "real-site-key", TURNSTILE_SECRET_KEY: "private-secret", TOKEN_ENC_KEY: "private-encryption-key", ...overrides }) as Env;
const success = async (overrides: Record<string, unknown> = {}) => ({ success: true, hostname: "app.example.com", action: "guide_join", cdata: await sha256Hex(`guide-join:${GUIDE}`), "error-codes": [], ...overrides });
const stubFetch = () => {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests are disabled in this test"); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("공개 guide join의 Turnstile 설정", () => {
  it("공개 challenge에는 sitekey·고정 action·guide별 64자 SHA256만 반환한다", async () => {
    const settings = env();
    const challenge = await publicJoinChallenge(settings, GUIDE);
    expect(challenge).toEqual({ siteKey: settings.TURNSTILE_SITE_KEY, action: "guide_join", cData: await sha256Hex(`guide-join:${GUIDE}`) });
    expect(challenge.cData).toMatch(/^[a-f0-9]{64}$/);
    expect((await publicJoinChallenge(settings, "guide-two")).cData).not.toBe(challenge.cData);
    expect(JSON.stringify(challenge)).not.toContain(settings.TURNSTILE_SECRET_KEY!);
    expect(JSON.stringify(challenge)).not.toContain(settings.TOKEN_ENC_KEY!);
  });

  it.each(["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "TOKEN_ENC_KEY"] as const)("%s 누락·빈 값은 공개 challenge와 검증을 닫는다", async (key) => {
    const fetcher = stubFetch();
    for (const value of [undefined, "", "  "]) {
      const settings = env({ [key]: value });
      expect(turnstileConfigured(settings)).toBe(false);
      expect((await publicJoinChallenge(settings, GUIDE)).siteKey).toBeNull();
      expect(await verifyPublicJoin(settings, "token", GUIDE, REQUEST_URL)).toBe("unavailable");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(TEST_SITE_KEYS)("운영 공식 dummy sitekey %s 를 허용하지 않는다", async (siteKey) => {
    const settings = env({ TURNSTILE_SITE_KEY: siteKey }), fetcher = stubFetch();
    expect(turnstileConfigured(settings)).toBe(false);
    expect((await publicJoinChallenge(settings, GUIDE)).siteKey).toBeNull();
    expect(await verifyPublicJoin(settings, "token", GUIDE, REQUEST_URL)).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(TEST_SECRET_KEYS)("운영 공식 dummy secret %s 를 허용하지 않는다", async (secretKey) => {
    expect(turnstileConfigured(env({ TURNSTILE_SECRET_KEY: secretKey }))).toBe(false);
    expect(turnstileConfigured(env({ APP_ENV: "development", TURNSTILE_SECRET_KEY: secretKey }))).toBe(true);
  });

  it("공식 dummy 앞뒤 공백은 운영 설정을 우회하지 못하고 HTTP도 호출하지 않는다", async () => {
    const fetcher = stubFetch();
    for (const key of TEST_SITE_KEYS) {
      for (const value of [` ${key}`, `${key} `, `\t${key}\n`]) {
        const settings = env({ TURNSTILE_SITE_KEY: value });
        expect(turnstileConfigured(settings)).toBe(false);
        expect((await publicJoinChallenge(settings, GUIDE)).siteKey).toBeNull();
        expect(await verifyPublicJoin(settings, "token", GUIDE, REQUEST_URL)).toBe("unavailable");
      }
    }
    for (const key of TEST_SECRET_KEYS) {
      for (const value of [` ${key}`, `${key} `, `\t${key}\n`]) {
        const settings = env({ TURNSTILE_SECRET_KEY: value });
        expect(turnstileConfigured(settings)).toBe(false);
        expect((await publicJoinChallenge(settings, GUIDE)).siteKey).toBeNull();
        expect(await verifyPublicJoin(settings, "token", GUIDE, REQUEST_URL)).toBe("unavailable");
      }
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "TOKEN_ENC_KEY"] as const)("%s 의 앞뒤 공백 설정은 환경과 관계없이 거부한다", async (key) => {
    const fetcher = stubFetch();
    for (const appEnv of ["production", "development"]) {
      for (const value of [" value", "value ", "\tvalue\n"]) {
        const settings = env({ APP_ENV: appEnv, [key]: value });
        expect(turnstileConfigured(settings)).toBe(false);
        expect((await publicJoinChallenge(settings, GUIDE)).siteKey).toBeNull();
        expect(await verifyPublicJoin(settings, "token", GUIDE, REQUEST_URL)).toBe("unavailable");
      }
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["invalid", "http://app.example.com", "mailto:example@example.com", "https://user:pass@app.example.com", "https://@app.example.com", "https://app.example.com/path", "https://app.example.com?query=value", "https://app.example.com#fragment", "https:app.example.com", "https:///app.example.com", " https://app.example.com", "https://app.example.com ", "https://app.example.com\\other"])("불량 운영 APP_URL %s 는 공개 challenge부터 비활성화한다", async (appUrl) => {
    const settings = env({ APP_URL: appUrl }), fetcher = stubFetch();
    expect(turnstileConfigured(settings)).toBe(false);
    expect((await publicJoinChallenge(settings, GUIDE)).siteKey).toBeNull();
    expect(await verifyPublicJoin(settings, "token", GUIDE, REQUEST_URL)).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["https://app.example.com", "https://app.example.com/", "https://app.example.com:8443"])("정상 운영 HTTPS origin %s 를 허용한다", async (appUrl) => {
    const settings = env({ APP_URL: appUrl }), fetcher = stubFetch();
    expect(turnstileConfigured(settings)).toBe(true);
    expect((await publicJoinChallenge(settings, GUIDE)).siteKey).toBe(settings.TURNSTILE_SITE_KEY);
    fetcher.mockResolvedValue(Response.json(await success()));
    expect(await verifyPublicJoin(settings, "token", GUIDE, REQUEST_URL)).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("개발 APP_URL이 불량해도 request hostname 검증 계약을 유지한다", async () => {
    const settings = env({ APP_ENV: "development", APP_URL: "invalid" }), fetcher = stubFetch();
    expect(turnstileConfigured(settings)).toBe(true);
    fetcher.mockResolvedValue(Response.json(await success({ hostname: "request.example.com" })));
    expect(await verifyPublicJoin(settings, "token", GUIDE, REQUEST_URL)).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("개발 공식 dummy key를 허용하고 공식 값과 다른 prefix 유사 key를 추측으로 차단하지 않는다", async () => {
    for (const siteKey of TEST_SITE_KEYS) expect(turnstileConfigured(env({ APP_ENV: "development", TURNSTILE_SITE_KEY: siteKey }))).toBe(true);
    expect(turnstileConfigured(env({ TURNSTILE_SITE_KEY: "1x-real-site-key", TURNSTILE_SECRET_KEY: "2x-real-secret-key" }))).toBe(true);
    const fetcher = stubFetch(); fetcher.mockResolvedValue(Response.json(await success({ hostname: "request.example.com" })));
    expect(await verifyPublicJoin(env({ APP_ENV: "development", TURNSTILE_SITE_KEY: TEST_SITE_KEYS[0], TURNSTILE_SECRET_KEY: TEST_SECRET_KEYS[0] }), "dummy-token", GUIDE, REQUEST_URL)).toBe("ok");
  });
});

describe("Siteverify와 공개 join context 검증", () => {
  it("고정 endpoint에 token·서버 secret·UUID만 보내고 production APP_URL hostname과 일치하면 한 번 호출한다", async () => {
    const settings = env(), fetcher = stubFetch(); fetcher.mockResolvedValue(Response.json(await success()));
    expect(await verifyPublicJoin(settings, "private-token", GUIDE, REQUEST_URL)).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(SITEVERIFY_URL); expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(init?.body));
    expect([...body.keys()].sort()).toEqual(["idempotency_key", "response", "secret"]);
    expect(body.get("secret")).toBe(settings.TURNSTILE_SECRET_KEY); expect(body.get("response")).toBe("private-token");
    expect(body.get("idempotency_key")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(body.has("remoteip")).toBe(false); expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("개발은 APP_URL 대신 현재 request hostname을 사용하고 host의 port는 비교하지 않는다", async () => {
    const fetcher = stubFetch(); fetcher.mockResolvedValue(Response.json(await success({ hostname: "localhost" })));
    expect(await verifyPublicJoin(env({ APP_ENV: "development" }), "token", GUIDE, "http://localhost:5173/g/guide")).toBe("ok");
  });

  it.each(["", "a".repeat(2_049), null, 3])("잘못된 token 길이·타입은 provider를 호출하지 않는다", async (token) => {
    const fetcher = stubFetch();
    expect(await verifyPublicJoin(env(), token as string, GUIDE, REQUEST_URL)).toBe("invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([1, 2_048])("token 길이 %i 는 검증할 수 있다", async (length) => {
    const fetcher = stubFetch(); fetcher.mockResolvedValue(Response.json(await success()));
    expect(await verifyPublicJoin(env(), "a".repeat(length), GUIDE, REQUEST_URL)).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { hostname: "request.example.com" },
    { hostname: "APP.EXAMPLE.COM" },
    { hostname: "app.example.com.evil.example" },
    { action: "other_action" },
    { cdata: "other-guide" },
  ])("hostname/action/cdata 불일치 %j 는 재시도 없이 거부한다", async (overrides) => {
    const fetcher = stubFetch(); fetcher.mockResolvedValue(Response.json(await success(overrides)));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("invalid"); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("다른 guide가 발급받은 context를 그대로 사용할 수 없다", async () => {
    const fetcher = stubFetch(); fetcher.mockResolvedValue(Response.json(await success()));
    expect(await verifyPublicJoin(env(), "token", "guide-two", REQUEST_URL)).toBe("invalid"); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([null, [], "success", {}, { success: "true" }, { success: false }, { success: false, "error-codes": [] }, { success: false, "error-codes": "internal-error" }, { success: false, "error-codes": [3] }])("malformed schema %j 는 한 번만 호출하고 닫는다", async (payload) => {
    const fetcher = stubFetch(); fetcher.mockResolvedValue(Response.json(payload));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("unavailable"); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["hostname", "action", "cdata"])("성공 응답에서 %s 가 없으면 허용하지 않는다", async (key) => {
    const payload: Record<string, unknown> = await success(); delete payload[key];
    const fetcher = stubFetch(); fetcher.mockResolvedValue(Response.json(payload));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("unavailable"); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["missing-input-response", "invalid-input-response", "timeout-or-duplicate"])("영구 token 실패 %s 는 재시도하지 않는다", async (code) => {
    const fetcher = stubFetch(); fetcher.mockResolvedValue(Response.json({ success: false, "error-codes": [code] }));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("invalid"); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([["invalid-input-secret"], ["missing-input-secret"], ["bad-request"], ["unknown-error"], ["internal-error", "invalid-input-secret"]])("영구 provider/config 오류 %j 는 재시도하지 않는다", async (...codes) => {
    const fetcher = stubFetch(); fetcher.mockResolvedValue(Response.json({ success: false, "error-codes": codes }));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("unavailable"); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("production APP_URL 또는 개발 request URL이 잘못되면 외부 요청 없이 닫는다", async () => {
    const fetcher = stubFetch();
    for (const url of ["invalid", "mailto:example@example.com"]) {
      expect(await verifyPublicJoin(env({ APP_URL: url }), "token", GUIDE, REQUEST_URL)).toBe("unavailable");
      expect(await verifyPublicJoin(env({ APP_ENV: "development" }), "token", GUIDE, url)).toBe("unavailable");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Siteverify 장애·재시도·정보 비노출", () => {
  it.each([400, 403, 429, 500, 503])("HTTP %i 는 body 내용과 관계없이 재시도하지 않는다", async (status) => {
    const fetcher = stubFetch(); fetcher.mockResolvedValue(new Response("private raw provider body", { status }));
    expect(await verifyPublicJoin(env(), "private-token", GUIDE, REQUEST_URL)).toBe("unavailable"); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("malformed JSON은 retry하지 않는다", async () => {
    const fetcher = stubFetch(); fetcher.mockResolvedValue(new Response("private raw provider body"));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("unavailable"); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("16KiB 초과 Content-Length는 body를 읽기 전에 취소하고 재시도하지 않는다", async () => {
    const pull = vi.fn(), cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    const fetcher = stubFetch(); fetcher.mockResolvedValue(new Response(stream, { headers: { "Content-Length": "16385" } }));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "1", "16384"])("Content-Length=%s 여도 실제 stream 16KiB 초과에서 멈추고 취소한다", async (declared) => {
    let read = 0;
    const cancel = vi.fn(), chunks = [new Uint8Array(8_192), new Uint8Array(8_193), new Uint8Array(1)];
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(chunks[read++]!); }, cancel }, { highWaterMark: 0 });
    const fetcher = stubFetch(); fetcher.mockResolvedValue(new Response(stream, { headers: declared ? { "Content-Length": declared } : {} }));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(read).toBe(2); expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("정확히 16KiB의 정상 JSON은 허용한다", async () => {
    const json = JSON.stringify(await success()), bytes = new TextEncoder().encode(json);
    const fetcher = stubFetch(); fetcher.mockResolvedValue(new Response(json + " ".repeat(16_384 - bytes.byteLength), { headers: { "Content-Length": "16384" } }));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("ok"); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("UTF-8 문자 수가 적어도 실제 16KiB를 넘으면 재시도 없이 거부한다", async () => {
    const json = JSON.stringify(await success({ extra: "한".repeat(5_500) }));
    expect(json.length).toBeLessThan(16_384); expect(new TextEncoder().encode(json).byteLength).toBeGreaterThan(16_384);
    const fetcher = stubFetch(); fetcher.mockResolvedValue(new Response(json));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("unavailable"); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("chunk 경계에서 분리된 UTF-8 문자를 정상으로 읽는다", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(await success({ extra: "한😀" })));
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (index === bytes.length) controller.close();
      else controller.enqueue(bytes.subarray(index, ++index));
    } });
    const fetcher = stubFetch(); fetcher.mockResolvedValue(new Response(stream));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("ok"); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("JSON 문자열 안의 잘못된 UTF-8도 대체문자로 허용하지 않고 재시도 없이 거부한다", async () => {
    const json = JSON.stringify(await success({ extra: "replace-me" })), bytes = new TextEncoder().encode(json);
    bytes[json.indexOf("replace-me")] = 255;
    const fetcher = stubFetch(); fetcher.mockResolvedValue(new Response(bytes));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("unavailable"); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("body stream network 오류는 같은 UUID로 한 번만 재시도할 수 있다", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new TypeError("private body network error")); } });
    const fetcher = stubFetch(); fetcher.mockResolvedValueOnce(new Response(stream)).mockResolvedValueOnce(Response.json(await success()));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("ok"); expect(fetcher).toHaveBeenCalledTimes(2);
    const bodies = fetcher.mock.calls.map(([, init]) => new URLSearchParams(String(init?.body)));
    expect(bodies[0]!.get("idempotency_key")).toBe(bodies[1]!.get("idempotency_key"));
    expect(console.error).not.toHaveBeenCalled(); expect(console.warn).not.toHaveBeenCalled(); expect(console.log).not.toHaveBeenCalled();
  });

  it("반복 body stream 오류도 전체 두 번으로 끝난다", async () => {
    const fetcher = stubFetch(); fetcher.mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.error(new TypeError("private body network error")); } })));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("unavailable"); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("headers 대기와 body 읽기를 합쳐 5초에 abort한다", async () => {
    const good = JSON.stringify(await success());
    vi.useFakeTimers();
    const fetcher = stubFetch(), startedAt: number[] = [];
    fetcher.mockImplementationOnce(async (_url, init) => new Promise<Response>((resolve) => {
      startedAt.push(Date.now());
      setTimeout(() => resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{"success":'));
        init!.signal!.addEventListener("abort", () => controller.error(new Error("private body timeout")), { once: true });
      } }))), 3_000);
    })).mockResolvedValueOnce(new Response(good));
    const pending = verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(4_999 - (Date.now() - startedAt[0]!));
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe("ok"); expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it.each(["internal-error", "network"])("%s 후 동일 UUID로 한 번만 재시도해 회복할 수 있다", async (failure) => {
    const fetcher = stubFetch();
    if (failure === "network") fetcher.mockRejectedValueOnce(new TypeError("private network error"));
    else fetcher.mockResolvedValueOnce(Response.json({ success: false, "error-codes": ["internal-error"] }));
    fetcher.mockResolvedValueOnce(Response.json(await success()));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("ok"); expect(fetcher).toHaveBeenCalledTimes(2);
    const bodies = fetcher.mock.calls.map(([, init]) => new URLSearchParams(String(init?.body)));
    expect(bodies[0]!.get("idempotency_key")).toBe(bodies[1]!.get("idempotency_key"));
    expect(bodies[0]!.get("response")).toBe(bodies[1]!.get("response"));
    expect(fetcher.mock.calls[0]![1]?.signal).not.toBe(fetcher.mock.calls[1]![1]?.signal);
  });

  it.each(["internal-error", "network"])("반복 %s 는 총 두 번으로 끝난다", async (failure) => {
    const fetcher = stubFetch();
    if (failure === "network") fetcher.mockRejectedValue(new TypeError("private network error"));
    else fetcher.mockImplementation(async () => Response.json({ success: false, "error-codes": ["internal-error"] }));
    expect(await verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL)).toBe("unavailable"); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("각 attempt는 5초에 abort되고 재시도도 5초 후 종료한다", async () => {
    vi.useFakeTimers();
    const fetcher = stubFetch(), startedAt: number[] = [];
    fetcher.mockImplementation(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      startedAt.push(Date.now());
      init!.signal!.addEventListener("abort", () => reject(new Error("private aborted request")), { once: true });
    }));
    const pending = verifyPublicJoin(env(), "token", GUIDE, REQUEST_URL);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(4_999 - (Date.now() - startedAt[0]!)); expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000); expect(await pending).toBe("unavailable"); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]![1]!.signal!.aborted).toBe(true);
  });

  it("별도 검증마다 새로운 UUID를 생성한다", async () => {
    const fetcher = stubFetch(); fetcher.mockImplementation(async () => Response.json(await success()));
    expect(await verifyPublicJoin(env(), "one", GUIDE, REQUEST_URL)).toBe("ok");
    expect(await verifyPublicJoin(env(), "two", GUIDE, REQUEST_URL)).toBe("ok");
    expect(new URLSearchParams(String(fetcher.mock.calls[0]![1]?.body)).get("idempotency_key")).not.toBe(new URLSearchParams(String(fetcher.mock.calls[1]![1]?.body)).get("idempotency_key"));
  });

  it("provider 본문·token·secret·예외를 응답 결과나 로그로 노출하지 않는다", async () => {
    const fetcher = stubFetch();
    fetcher.mockRejectedValueOnce(new Error("private-token private-secret private-encryption-key"));
    fetcher.mockResolvedValueOnce(new Response("private raw provider body"));
    expect(await verifyPublicJoin(env(), "private-token", GUIDE, REQUEST_URL)).toBe("unavailable");
    expect(console.error).not.toHaveBeenCalled(); expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("[turnstile] verification_unavailable", { reason: "json" });
  });

  it("HTTP 장애는 상태 코드만 기록하고 본문은 기록하지 않는다", async () => {
    stubFetch().mockResolvedValue(new Response("private-token private-secret", { status: 403 }));
    expect(await verifyPublicJoin(env(), "private-token", GUIDE, REQUEST_URL)).toBe("unavailable");
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("[turnstile] verification_unavailable", { reason: "http", status: 403 });
  });

  it("provider 진단은 알려진 오류 코드만 중복 없이 기록한다", async () => {
    stubFetch().mockResolvedValue(Response.json({ success: false, "error-codes": ["invalid-input-secret", "private-token private-secret", "invalid-input-secret"] }));
    expect(await verifyPublicJoin(env(), "private-token", GUIDE, REQUEST_URL)).toBe("unavailable");
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("[turnstile] verification_unavailable", { reason: "provider", codes: ["invalid-input-secret"] });
  });

  it("재시도까지 네트워크 실패하면 예외 대신 분류만 남긴다", async () => {
    stubFetch().mockRejectedValue(new Error("private-token private-secret"));
    expect(await verifyPublicJoin(env(), "private-token", GUIDE, REQUEST_URL)).toBe("unavailable");
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("[turnstile] verification_unavailable", { reason: "network", timeout: false });
  });
});
