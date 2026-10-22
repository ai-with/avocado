import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope, SdkEvent } from "../../src/shared/sdk-events";
import { KEY_QUEUE, OFFLINE_MAX_EVENTS } from "../src/config";
import { SdkStorage } from "../src/storage";
import { Transport } from "../src/transport";
import { resetBrowserState, stubFetch } from "./helpers";

const ENDPOINT = "https://app.test/collect";

function event(index: number): SdkEvent {
  return { t: "track", name: `e${index}`, props: {}, id: `id${index}`, ts: Date.now(), url: "https://s.test/", ref: null };
}

function makeTransport(persist = true): { transport: Transport; storage: SdkStorage } {
  const storage = new SdkStorage(null, 30);
  storage.setPersistent(persist);
  const transport = new Transport({
    endpoint: ENDPOINT,
    storage,
    canPersist: () => persist,
    buildEnvelope: (events) => ({ events }) as unknown as Envelope,
  });
  return { transport, storage };
}

function offline(): SdkEvent[] {
  return JSON.parse(localStorage.getItem(KEY_QUEUE) ?? "[]") as SdkEvent[];
}

beforeEach(() => {
  resetBrowserState();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("배치", () => {
  it("20개가 차면 바로 보낸다", () => {
    const { fetchMock } = stubFetch();
    const { transport } = makeTransport();
    for (let i = 0; i < 19; i++) transport.enqueue(event(i));
    expect(fetchMock).not.toHaveBeenCalled();
    transport.enqueue(event(19));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("5초가 지나면 쌓인 것을 보낸다", () => {
    const { fetchMock, envelopes } = stubFetch();
    const { transport } = makeTransport();
    transport.enqueue(event(1));
    vi.advanceTimersByTime(4_999);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(envelopes[0]?.events).toHaveLength(1);
  });

  it("text/plain, keepalive로 /collect에 보낸다", () => {
    const { fetchMock } = stubFetch();
    makeTransport().transport.enqueue(event(1), true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.keepalive).toBe(true);
    expect(new Headers(init.headers).get("Content-Type")).toBe("text/plain;charset=UTF-8");
  });

  it("60KB를 넘는 봉투는 나눠 보낸다", () => {
    const { envelopes } = stubFetch();
    const { transport } = makeTransport();
    const big = "x".repeat(4_000);
    for (let i = 0; i < 20; i++) transport.enqueue({ ...event(i), props: { big } } as SdkEvent);
    expect(envelopes.length).toBeGreaterThan(1);
    expect(envelopes.flatMap((e) => e.events)).toHaveLength(20);
  });
});

describe("재시도", () => {
  it("4xx는 재시도하지 않고 버린다", async () => {
    const { fetchMock } = stubFetch(400);
    makeTransport().transport.enqueue(event(1), true);
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(offline()).toHaveLength(0);
  });

  it("5xx는 2초·8초·30초 3회 재시도 후 오프라인 버퍼에 둔다", async () => {
    const { fetchMock } = stubFetch(503);
    makeTransport().transport.enqueue(event(1), true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(offline().map((e) => e.id)).toEqual(["id1"]);
  });

  it("네트워크 오류도 재시도한다", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    makeTransport().transport.enqueue(event(1), true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("오프라인 버퍼", () => {
  it("최대 200개만 남기고 다음 로드에 다시 보낸다", async () => {
    stubFetch(503);
    const { transport } = makeTransport();
    for (let i = 0; i < 210; i++) transport.enqueue(event(i));
    await vi.runAllTimersAsync();
    expect(offline()).toHaveLength(OFFLINE_MAX_EVENTS);
    expect(offline()[0]?.id).toBe("id10");

    const { envelopes } = stubFetch();
    makeTransport().transport.restoreOffline();
    await vi.advanceTimersByTimeAsync(0);
    expect(envelopes.flatMap((e) => e.events)).toHaveLength(OFFLINE_MAX_EVENTS);
    expect(localStorage.getItem(KEY_QUEUE)).toBeNull();
  });

  it("동의 전(pending)에는 디스크에 쓰지 않는다", async () => {
    stubFetch(503);
    makeTransport(false).transport.enqueue(event(1), true);
    await vi.runAllTimersAsync();
    expect(localStorage.getItem(KEY_QUEUE)).toBeNull();
  });
});

describe("페이지 숨김", () => {
  it("남은 큐와 재시도 대기분을 sendBeacon으로 보낸다", async () => {
    const { fetchMock } = stubFetch(503);
    const beacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: beacon });
    const { transport } = makeTransport();
    transport.enqueue(event(1), true);
    await vi.advanceTimersByTimeAsync(0);
    transport.enqueue(event(2));
    transport.flushBeacon();
    expect(beacon).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((beacon.mock.calls[0] as unknown[])[1])) as Envelope;
    expect(body.events.map((e) => e.id)).toEqual(["id1", "id2"]);
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sendBeacon이 거절하면 오프라인 버퍼에 둔다", () => {
    stubFetch();
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: vi.fn(() => false) });
    const { transport } = makeTransport();
    transport.enqueue(event(1));
    transport.flushBeacon();
    expect(offline()).toHaveLength(1);
  });
});
