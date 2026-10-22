import { afterEach, describe, expect, it, vi } from "vitest";
import { envelopeSchema } from "../../src/server/lib/collect/schema";
import { AvocadoSdk } from "../src/sdk";
import { makeConfig, resetBrowserState, stubFetch } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// SDK가 만든 봉투가 서버 zod 스키마(/collect)를 그대로 통과하는지 본다. 어긋나면 서버가 400으로 통째 버린다
describe("서버 스키마 계약", () => {
  it("모든 이벤트 종류가 하나도 버려지지 않고 통과한다", async () => {
    vi.useFakeTimers();
    resetBrowserState("/landing?avc=AbC_123-xyz&utm_source=insta&utm_campaign=g1");
    document.body.innerHTML = `<form id="f"><input name="a"></form><button>buy</button>`;
    const { envelopes } = stubFetch();
    const sdk = new AvocadoSdk(makeConfig());
    sdk.start();
    sdk.track("webinar_click", { plan: "pro", seats: 3, trial: true, nested: { no: 1 } });
    sdk.conversion({ type: "purchase", value: 39000, currency: "KRW", orderId: "A-1029" });
    await sdk.identify({ email: "a@b.com", externalId: "u_1", name: "홍길동" });
    document.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true }));
    vi.advanceTimersByTime(1_000);
    history.pushState(null, "", "/next");
    vi.advanceTimersByTime(5_000);
    sdk.destroy();

    const kinds = new Set<string>();
    for (const envelope of envelopes) {
      const parsed = envelopeSchema.parse(envelope);
      expect(parsed.events).toHaveLength(envelope.events.length);
      for (const event of parsed.events) kinds.add(event.t);
    }
    expect([...kinds].sort()).toEqual(
      ["click", "conversion", "dwell", "form_submit", "identify", "pageview", "scroll", "track"].sort(),
    );
  });
});
