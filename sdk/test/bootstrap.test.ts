import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope } from "../../src/shared/sdk-events";
import { boot, type AvocadoFunction } from "../src/boot";
import { KEY_ATTR, KEY_ID, KEY_MEMBER, KEY_OPT_OUT } from "../src/config";
import { AvocadoSdk } from "../src/sdk";
import { makeConfig, resetBrowserState, sentEvents, stubFetch } from "./helpers";

let sdk: AvocadoSdk | null = null;
function script() { const node = document.createElement("script"); node.src = "https://app.test/sdk/v1.js"; node.dataset.site = "site_test"; return node; }
function stub() { const value: AvocadoFunction = Object.assign((...args: unknown[]) => { value.q!.push(args); }, { q: [] as unknown[][] }); window.avocado = value; return value; }
const configResponse = (mode = "require", site = "site_test") => Response.json({ site, consentMode: mode });
beforeEach(() => { resetBrowserState("/landing?avc=click123&avc_optout=1"); delete window.avocado; });
afterEach(() => { sdk?.destroy(); sdk = null; delete window.avocado; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("서버 동의 bootstrap", () => {
  it("config 전에는 저장·cookie probe·수집을 하지 않고 늦은 큐 명령도 반영한다", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((done) => { resolve = done; })); vi.stubGlobal("fetch", fetcher);
    const queue = stub(), pending = boot(window, script());
    expect(localStorage.length).toBe(0); expect(document.cookie).toBe(""); expect(fetcher).toHaveBeenCalledTimes(1);
    queue("init", { consent: "require" }); queue("consent", "pending"); queue("track", "queued");
    resolve(configResponse("auto")); sdk = await pending;
    expect(sdk).not.toBeNull(); expect(localStorage.length).toBe(0); expect(document.cookie).toBe(""); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe("https://app.test/sdk/config?site=site_test");
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ credentials: "omit", redirect: "error", cache: "no-store" });
  });

  it("server require는 snippet 수정 없이 동의 전 저장과 수집을 막는다", async () => {
    const bodies: Envelope[] = [], fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.body) return configResponse(); bodies.push(JSON.parse(String(init.body))); return new Response(null, { status: 204 });
    }); vi.stubGlobal("fetch", fetcher);
    sdk = await boot(window, script());
    for (const key of [KEY_ID, KEY_ATTR, KEY_MEMBER]) expect(localStorage.getItem(key)).toBeNull(); expect(bodies).toEqual([]);
    window.avocado!("consent", "granted"); sdk!.conversion({ type: "signup" });
    expect(localStorage.getItem(KEY_MEMBER)).toBe("1"); expect(localStorage.getItem(KEY_ID)).not.toBeNull();
    expect(bodies.length).toBeGreaterThan(0); expect(bodies.every((body) => body.consent === "granted")).toBe(true);
    sdk!.consent("pending"); const count = bodies.length; sdk!.conversion({ type: "signup" }); expect(bodies).toHaveLength(count);
  });

  it("snippet require는 서버 auto보다 엄격하고 queued pending으로도 풀리지 않는다", async () => {
    const fetcher = vi.fn(async () => configResponse("auto")); vi.stubGlobal("fetch", fetcher);
    const node = script(); node.dataset.consent = "require"; stub()("consent", "pending");
    sdk = await boot(window, node); expect(fetcher).toHaveBeenCalledTimes(1); expect(localStorage.length).toBe(0);
  });

  it("preload optOut은 첫 pageview 전 적용하고 DNT/GPC는 grant로도 풀 수 없다", async () => {
    const fetcher = vi.fn(async () => configResponse("auto")); vi.stubGlobal("fetch", fetcher);
    stub()("optOut"); sdk = await boot(window, script()); expect(localStorage.getItem(KEY_OPT_OUT)).toBe("1"); expect(fetcher).toHaveBeenCalledTimes(1);
    sdk!.destroy(); sdk = null; delete window.avocado;
    vi.stubGlobal("navigator", { doNotTrack: "1", globalPrivacyControl: true });
    stub()("consent", "granted"); sdk = await boot(window, script()); sdk!.consent("granted"); sdk!.conversion({ type: "signup" });
    expect(localStorage.getItem(KEY_ID)).toBeNull(); expect(localStorage.getItem(KEY_OPT_OUT)).toBe("1"); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("init은 site/api/server mode를 바꾸지 못한다", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => configResponse()); vi.stubGlobal("fetch", fetcher);
    stub()("init", { site: "other", api: "https://evil.test", consentMode: "auto", consent: "pending" });
    sdk = await boot(window, script()); expect(fetcher).toHaveBeenCalledTimes(1); expect(localStorage.length).toBe(0);
    expect(fetcher.mock.calls[0]![0]).toBe("https://app.test/sdk/config?site=site_test");
  });

  it("중복 boot는 하나의 config 요청과 인스턴스만 만든다", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((done) => { resolve = done; })); vi.stubGlobal("fetch", fetcher);
    const first = boot(window, script()), second = boot(window, script()); expect(first).toBe(second); resolve(configResponse());
    sdk = await first; expect(await second).toBe(sdk); expect(await boot(window, script())).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([new Response("redirect", { status: 302 }), new Response(null, { status: 403 }), new Response(null, { status: 404 }), new Response(null, { status: 503 }), new Response("not json"), Response.json({ site: "other", consentMode: "auto" }), Response.json({ site: "site_test" }), Response.json({ site: "site_test", consentMode: "granted" }), new Response("x".repeat(2_049))])("실패/잘못된 config는 auto fallback하지 않는다 %#", async (response) => {
    const fetcher = vi.fn(async () => response); vi.stubGlobal("fetch", fetcher);
    expect(await boot(window, script())).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1); expect(localStorage.length).toBe(0); expect(document.cookie).toBe(""); expect(window.avocado?.loaded).not.toBe(true);
  });

  it("config timeout은 전송 없이 끝난다", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("timeout"))))); vi.stubGlobal("fetch", fetcher);
    const pending = boot(window, script()); await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1); expect(localStorage.length).toBe(0);
  });
});

describe("비동기 identify 세대 경계", () => {
  it.each(["reset", "deny", "destroy"])("hash가 늦게 끝나도 %s 뒤 과거 identify를 보내지 않는다", async (action) => {
    const { envelopes } = stubFetch(); sdk = new AvocadoSdk(makeConfig()); sdk.start();
    let complete!: (value: ArrayBuffer) => void;
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(() => new Promise<ArrayBuffer>((resolve) => { complete = resolve; }));
    const pending = sdk.identify({ email: "private@example.com" });
    if (action === "reset") sdk.reset(); else if (action === "destroy") sdk.destroy(); else { sdk.consent("denied"); sdk.consent("granted"); }
    complete(new Uint8Array(32).buffer); await pending;
    expect(sentEvents(envelopes).some((event) => event.t === "identify")).toBe(false);
  });

  it("deny→grant는 메모리의 이전 identity와 attribution을 되살리지 않는다", () => {
    const { envelopes } = stubFetch(); sdk = new AvocadoSdk(makeConfig()); sdk.start(); const before = envelopes[0]!.anon;
    sdk.consent("denied"); sdk.consent("granted"); sdk.conversion({ type: "signup" });
    expect(envelopes[envelopes.length - 1]!.anon).not.toBe(before); expect(envelopes[envelopes.length - 1]!.attr.last).toBeNull();
  });
});

describe("preload 개인정보 경계", () => {
  function transport(mode: "auto" | "require") {
    const bodies: Envelope[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.body) return configResponse(mode);
      bodies.push(JSON.parse(String(init.body))); return new Response(null, { status: 204 });
    }));
    vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new Uint8Array(32).buffer);
    return bodies;
  }
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it("identify(A)→optOut→grant는 A나 철회 전 attribution을 새 grant로 보내지 않는다", async () => {
    const bodies = transport("auto"), queue = stub();
    queue("identify", { email: "old-private@example.com" }); queue("optOut"); queue("consent", "granted");
    sdk = await boot(window, script()); await settle();
    expect(sentEvents(bodies).some((event) => event.t === "identify")).toBe(false);
    expect(bodies.length).toBeGreaterThan(0); expect(bodies.every((body) => body.attr.first === null && body.attr.last === null)).toBe(true);
  });

  it("저장된 old queue/id는 preloaded reset이 constructor 복원·첫 pageview보다 먼저 지운다", async () => {
    const bodies = transport("auto"); sdk = new AvocadoSdk(makeConfig()); sdk.start(); const oldAnon = bodies[0]!.anon;
    sdk.destroy(); sdk = null; bodies.length = 0;
    localStorage.setItem("avc_q", JSON.stringify([{ t: "track", name: "old_offline", props: {}, id: "old_event_001", ts: Date.now(), url: location.href, ref: null }]));
    stub()("reset"); sdk = await boot(window, script()); await settle();
    expect(sentEvents(bodies).some((event) => event.t === "track" && event.name === "old_offline")).toBe(false);
    expect(bodies.length).toBeGreaterThan(0); expect(bodies.every((body) => body.anon !== oldAnon)).toBe(true);
  });

  it("require에서 grant 전에 쌓인 track/identify는 버리고 이후 명령만 처리한다", async () => {
    const bodies = transport("require"), queue = stub();
    queue("track", "before_grant"); queue("identify", { email: "before-private@example.com", externalId: "before-user" }); queue("consent", "granted"); queue("track", "after_grant"); queue("identify", { externalId: "after-user" });
    sdk = await boot(window, script()); sdk!.conversion({ type: "signup" }); await settle();
    const events = sentEvents(bodies);
    expect(events.some((event) => event.t === "track" && event.name === "before_grant")).toBe(false);
    expect(events.filter((event) => event.t === "identify").map((event) => event.externalId)).toEqual(["after-user"]);
    expect(events.some((event) => event.t === "track" && event.name === "after_grant")).toBe(true);
  });
});

describe("preload 명령 순서 유지", () => {
  it("auto의 중복 grant는 이미 허용된 현재 세대 명령을 버리지 않는다", async () => {
    const { envelopes } = stubFetch(), queue = stub();
    queue("track", "already_allowed"); queue("consent", "granted"); queue("track", "still_allowed");
    sdk = await boot(window, script()); sdk!.conversion({ type: "signup" });
    expect(sentEvents(envelopes).filter((event) => event.t === "track").map((event) => event.name)).toEqual(["already_allowed", "still_allowed"]);
  });

  it("reset 이전 명령은 버리고 이후 현재 세대 명령은 보낸다", async () => {
    const { envelopes } = stubFetch(), queue = stub();
    queue("track", "before_reset"); queue("reset"); queue("track", "after_reset");
    sdk = await boot(window, script()); sdk!.conversion({ type: "signup" });
    expect(sentEvents(envelopes).filter((event) => event.t === "track").map((event) => event.name)).toEqual(["after_reset"]);
    expect(envelopes.every((envelope) => envelope.attr.first === null && envelope.attr.last === null)).toBe(true);
  });

  it("runtime optOut은 pending으로 풀리지 않고 명시 grant 이후에만 수집한다", () => {
    const { envelopes } = stubFetch(); sdk = new AvocadoSdk(makeConfig()); sdk.start();
    sdk.optOut(); sdk.consent("pending"); const count = envelopes.length; sdk.conversion({ type: "signup" }); expect(envelopes).toHaveLength(count);
    sdk.consent("granted"); sdk.conversion({ type: "signup" }); expect(envelopes.length).toBeGreaterThan(count);
    expect(envelopes[envelopes.length - 1]!.attr.last).toBeNull();
  });
});
