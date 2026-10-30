import { describe, expect, it } from "vitest";
import { placePopover } from "./usePopoverPosition";
import { filterOptions, groupOptions, moveActive, shouldSearch, summaryLabel, toggleValue, typeaheadIndex, visualOrder, type SelectOption } from "./selectMenuLogic";

const OPTIONS: SelectOption[] = [
  { value: "ig", label: "인스타그램", group: "SNS" },
  { value: "yt", label: "유튜브", description: "긴 영상·쇼츠", group: "영상" },
  { value: "tt", label: "틱톡", disabled: true, group: "영상" },
  { value: "th", label: "스레드", group: "SNS" },
  { value: "bl", label: "블로그" },
];

describe("거르기", () => {
  it("이름과 설명에서 찾고 앞뒤 공백·대소문자를 무시한다", () => {
    expect(filterOptions(OPTIONS, "튜브").map((o) => o.value)).toEqual(["yt"]);
    expect(filterOptions(OPTIONS, " 쇼츠 ").map((o) => o.value)).toEqual(["yt"]);
    expect(filterOptions([{ value: "a", label: "Alpha" }], "alp")).toHaveLength(1);
    expect(filterOptions(OPTIONS, "")).toHaveLength(5);
    expect(filterOptions(OPTIONS, "없는말")).toHaveLength(0);
  });
  it("선택지가 8개 이상이면 검색을 켠다. prop 이 있으면 그것을 따른다", () => {
    expect(shouldSearch(7)).toBe(false);
    expect(shouldSearch(8)).toBe(true);
    expect(shouldSearch(20, false)).toBe(false);
    expect(shouldSearch(2, true)).toBe(true);
  });
});

describe("묶기", () => {
  it("처음 나온 순서로 묶고 index 는 원래 위치", () => {
    const groups = groupOptions(OPTIONS);
    expect(groups.map((g) => g.label)).toEqual(["SNS", "영상", undefined]);
    expect(groups[0]?.items.map((i) => i.index)).toEqual([0, 3]);
    expect(visualOrder(OPTIONS).map((o) => o.value)).toEqual(["ig", "th", "yt", "tt", "bl"]);
  });
});

describe("키 이동", () => {
  const list = visualOrder(OPTIONS); // ig th yt tt(비활성) bl
  it("아래·위는 비활성을 건너뛰고 끝에서 멈춘다", () => {
    expect(moveActive(list, -1, "ArrowDown")).toBe(0);
    expect(moveActive(list, 2, "ArrowDown")).toBe(4);
    expect(moveActive(list, 4, "ArrowDown")).toBe(4);
    expect(moveActive(list, 0, "ArrowUp")).toBe(0);
    expect(moveActive(list, -1, "ArrowUp")).toBe(4);
  });
  it("Home·End·PageDown", () => {
    expect(moveActive(list, 2, "Home")).toBe(0);
    expect(moveActive(list, 0, "End")).toBe(4);
    expect(moveActive(list, 0, "PageDown")).toBe(4);
  });
  it("고를 것이 없으면 -1", () => {
    expect(moveActive([{ value: "x", label: "x", disabled: true }], -1, "ArrowDown")).toBe(-1);
    expect(moveActive([], -1, "Home")).toBe(-1);
  });
});

describe("글자로 찾기", () => {
  const list: SelectOption[] = [
    { value: "a", label: "Apple" }, { value: "b", label: "Banana" }, { value: "c", label: "Avocado" }, { value: "d", label: "Apricot", disabled: true },
  ];
  it("다음 위치부터 시작 글자로 찾고 비활성은 건너뛴다", () => {
    expect(typeaheadIndex(list, -1, "a")).toBe(0);
    expect(typeaheadIndex(list, 0, "a")).toBe(2);
    expect(typeaheadIndex(list, 2, "a")).toBe(0);
    expect(typeaheadIndex(list, 0, "aa")).toBe(2);
  });
  it("여러 글자는 지금 항목부터 단어로 찾는다", () => {
    expect(typeaheadIndex(list, 0, "av")).toBe(2);
    expect(typeaheadIndex(list, 0, "ap")).toBe(0);
    expect(typeaheadIndex(list, 0, "zz")).toBe(-1);
  });
});

describe("고르기", () => {
  it("다중 선택은 넣고 뺀다", () => {
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });
  it("닫힌 칸 요약", () => {
    expect(summaryLabel(OPTIONS, [])).toBe("");
    expect(summaryLabel(OPTIONS, ["yt"])).toBe("유튜브");
    expect(summaryLabel(OPTIONS, ["yt", "ig"])).toBe("2개 선택");
  });
});

describe("목록 위치", () => {
  const view = { width: 1000, height: 800 };
  const wanted = { maxHeight: 320, minWidth: 200 };
  const rect = (top: number, left = 100, width = 150, height = 40) => ({ top, left, width, bottom: top + height });
  it("아래 공간이 넉넉하면 아래로, 폭은 최소 폭 이상", () => {
    const p = placePopover(rect(100), view, wanted);
    expect(p.side).toBe("bottom");
    expect(p.style.top).toBe(144);
    expect(p.style.width).toBe(200);
  });
  it("아래가 모자라고 위가 넓으면 위로 연다", () => {
    const p = placePopover(rect(700), view, wanted);
    expect(p.side).toBe("top");
    expect(p.style.bottom).toBe(104);
    expect(p.style.maxHeight).toBe(320);
  });
  it("오른쪽 끝 칸은 화면 안으로 밀어 넣는다", () => {
    expect(placePopover(rect(100, 900), view, wanted).style.left).toBe(792);
  });
});
