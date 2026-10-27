import { describe, expect, it } from "vitest";
import { selectInChunks } from "./chunks";

describe("selectInChunks", () => {
  it("250개를 90, 90, 70으로 나눠 부르고 결과를 합친다", async () => {
    const sizes: number[] = [];
    const ids = Array.from({ length: 250 }, (_, i) => i);
    const out = await selectInChunks(ids, async (part) => {
      sizes.push(part.length);
      return part;
    });
    expect(sizes).toEqual([90, 90, 70]);
    expect(out).toEqual(ids);
  });

  it("빈 입력은 호출하지 않는다", async () => {
    let calls = 0;
    const out = await selectInChunks([], async () => {
      calls++;
      return [1];
    });
    expect(calls).toBe(0);
    expect(out).toEqual([]);
  });
});
