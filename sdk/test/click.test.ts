import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRageDetector, installClickCapture, normalizeCoord, normalizeText, viewportBucket } from "../src/capture/click";
import { cssPath } from "../src/capture/dom";
import { countFields, installFormCapture } from "../src/capture/form";
import type { EventInput, Uninstall } from "../src/types";
import { resetBrowserState, setDocumentSize } from "./helpers";

let events: EventInput[] = [];
let uninstall: Uninstall[] = [];

function click(element: Element, pageX = 100, pageY = 200): void {
  const event = new MouseEvent("click", { bubbles: true });
  Object.defineProperty(event, "pageX", { value: pageX });
  Object.defineProperty(event, "pageY", { value: pageY });
  element.dispatchEvent(event);
}

function setup(html: string, autocapture = true): void {
  document.body.innerHTML = html;
  uninstall = [installClickCapture({ autocapture, emit: (e) => events.push(e) }), installFormCapture((e) => events.push(e))];
}

beforeEach(() => {
  resetBrowserState();
  events = [];
  setDocumentSize(1000, 4000);
});
afterEach(() => uninstall.forEach((fn) => fn()));

describe("선택자", () => {
  it("id를 만나면 멈추고 최대 5단계까지만 만든다", () => {
    document.body.innerHTML = `<div id="root"><section class="a b c"><div><div><div><div><button class="cta">x</button></div></div></div></div></section></div>`;
    const button = document.querySelector("button") as Element;
    expect(cssPath(button)).toBe("div > div > div > div > button.cta");
    document.body.innerHTML = `<div id="root"><button>x</button></div>`;
    expect(cssPath(document.querySelector("button") as Element)).toBe("#root > button");
  });
});

describe("클릭 수집", () => {
  it("버튼 클릭: 텍스트 공백 정리·80자, 좌표 정규화, 뷰포트 구간", () => {
    setup(`<button class="buy">  ${"가".repeat(50)}\n\n ${"나".repeat(50)} </button>`);
    click(document.querySelector("button") as Element, 333, 1000);
    const event = events[0];
    expect(event?.t).toBe("click");
    if (event?.t !== "click") return;
    expect(event.text).toHaveLength(80);
    expect(event.text).not.toMatch(/\s{2}/);
    expect(event.x).toBe(0.333);
    expect(event.y).toBe(0.25);
    expect(event.sel).toBe("body > button.buy");
  });

  it("링크 href에서 쿼리와 해시를 뺀다", () => {
    setup(`<a href="https://s.test/p?email=a@b.com#x"><span>go</span></a>`);
    click(document.querySelector("span") as Element);
    expect(events[0]).toMatchObject({ t: "click", href: "https://s.test/p", text: "go" });
  });

  it("추적 대상이 아닌 요소, 제외 클래스 하위는 버린다", () => {
    setup(`<p>text</p><div class="avc-no-capture"><button>a</button></div><div data-avc-no-capture><a href="/x">b</a></div>`);
    click(document.querySelector("p") as Element);
    click(document.querySelector("button") as Element);
    click(document.querySelector("a") as Element);
    expect(events).toHaveLength(0);
  });

  it("data-avc-track은 그 이름으로 track을 보낸다 (autocapture 꺼도)", () => {
    setup(`<div data-avc-track="webinar_click">신청</div>`, false);
    click(document.querySelector("div") as Element);
    expect(events).toEqual([{ t: "track", name: "webinar_click", props: {} }]);
  });

  it("1초 안 30px 안 3회면 rage 표시", () => {
    const isRage = createRageDetector();
    expect(isRage({ x: 0, y: 0, at: 0 })).toBe(false);
    expect(isRage({ x: 10, y: 10, at: 300 })).toBe(false);
    expect(isRage({ x: 5, y: 5, at: 600 })).toBe(true);
    expect(isRage({ x: 500, y: 5, at: 700 })).toBe(false);
  });
});

describe("정규화 함수", () => {
  it("좌표는 0~1로 자르고 소수 셋째 자리", () => {
    expect(normalizeCoord(1234.5, 1000)).toBe(1);
    expect(normalizeCoord(1, 3)).toBe(0.333);
    expect(normalizeCoord(10, 0)).toBe(0);
  });
  it("텍스트와 뷰포트", () => {
    expect(normalizeText(" a \n b ")).toBe("a b");
    expect([viewportBucket(375), viewportBucket(800), viewportBucket(1440)]).toEqual(["m", "t", "d"]);
  });
});

describe("폼 제출", () => {
  it("필드 개수만 세고 값은 보내지 않는다", () => {
    setup(`<form id="signup"><input name="email" value="a@b.com"><input type="password" value="pw"><input type="hidden"><select></select><button>가입</button></form>`);
    const form = document.querySelector("form") as HTMLFormElement;
    expect(countFields(form)).toBe(3);
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(events).toEqual([{ t: "form_submit", sel: "#signup", fields: 3 }]);
    expect(JSON.stringify(events)).not.toContain("a@b.com");
  });
});
