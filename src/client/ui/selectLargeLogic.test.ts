import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { optionsFromChildren } from "./selectLargeLogic";

describe("optionsFromChildren", () => {
  it("option 을 선택지로 바꾼다(value 없으면 글자, disabled 유지)", () => {
    const out = optionsFromChildren([h("option", { key: 1, value: "a" }, "첫째"), h("option", { key: 2, disabled: true }, "둘째")]);
    expect(out).toEqual([
      { value: "a", label: "첫째", disabled: undefined, group: undefined },
      { value: "둘째", label: "둘째", disabled: true, group: undefined },
    ]);
  });
  it("optgroup 은 group 으로 펼친다", () => {
    const out = optionsFromChildren(h("optgroup", { label: "국내" }, h("option", { value: "kr" }, "한국"), h("option", { value: "jp", disabled: true }, "일본")));
    expect(out.map((o) => [o.value, o.group, o.disabled])).toEqual([["kr", "국내", undefined], ["jp", "국내", true]]);
  });
  it("그 밖의 자식은 무시한다", () => {
    expect(optionsFromChildren(["텍스트", null, h("div", null, "x")])).toEqual([]);
  });
});
