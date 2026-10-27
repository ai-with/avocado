import { describe, expect, it } from "vitest";
import { signUnlock, verifyUnlock, UNLOCK_TTL_MS } from "./doc-unlock";
import { splitAtGate, topLevelBlocks } from "../../shared/doc-gate";
import { formClosedReason } from "../routes/public-lead/forms";

const KEY = "test-key";
const T0 = 1_700_000_000_000;

describe("게이트 앞 본문 자르기", () => {
  const p = (text: string) => `<p>${text}</p>`;
  const html = [p("a".repeat(100)), "<ul><li>" + "b".repeat(100) + "</li></ul>", p("c".repeat(100)), p("SECRET-TAIL".repeat(9))].join("");

  it("최상위 블록 단위로 나눈다(중첩 태그는 한 블록)", () => {
    expect(topLevelBlocks(html)).toHaveLength(4);
    expect(topLevelBlocks('<p>x</p><hr><img src="/a.png">')).toHaveLength(3);
  });

  it("게이트 비율 앞에서 시작하는 블록까지만 head 에 넣는다", () => {
    const { head, rest } = splitAtGate(html, 30);
    expect(head).toContain("b".repeat(100));
    expect(head).not.toContain("SECRET-TAIL");
    expect(rest).toContain("SECRET-TAIL");
    expect(head + rest).toBe(html);
  });

  it("0%는 아무것도, 100%는 전부 준다", () => {
    expect(splitAtGate(html, 0).head).toBe("");
    expect(splitAtGate(html, 100).rest).toBe("");
  });
});

describe("열람 토큰", () => {
  it("같은 자료, 만료 전이면 리드 id 를 돌려준다", async () => {
    const t = await signUnlock(KEY, "doc1", "lead1", T0);
    expect(await verifyUnlock(KEY, t, "doc1", T0 + 1000)).toBe("lead1");
  });

  it("만료, 다른 자료, 위조, 다른 키는 거절한다", async () => {
    const t = await signUnlock(KEY, "doc1", "lead1", T0);
    expect(await verifyUnlock(KEY, t, "doc1", T0 + UNLOCK_TTL_MS + 1)).toBeNull();
    expect(await verifyUnlock(KEY, t, "doc2", T0)).toBeNull();
    expect(await verifyUnlock("other", t, "doc1", T0)).toBeNull();
    const [d, , exp, sig] = t.split(".");
    expect(await verifyUnlock(KEY, `${d}.lead2.${exp}.${sig}`, "doc1", T0)).toBeNull();
    expect(await verifyUnlock(KEY, `${d}.lead1.${Number(exp) + UNLOCK_TTL_MS}.${sig}`, "doc1", T0)).toBeNull();
    expect(await verifyUnlock(KEY, undefined, "doc1", T0)).toBeNull();
    expect(await verifyUnlock(KEY, "garbage", "doc1", T0)).toBeNull();
  });
});

describe("폼 마감 판정", () => {
  it("마감일이 지나면 deadline, 정원이 차면 full", () => {
    expect(formClosedReason({ closesAt: T0 - 1, maxSubmissions: null }, 0, T0)).toBe("deadline");
    expect(formClosedReason({ closesAt: T0 + 1, maxSubmissions: 3 }, 3, T0)).toBe("full");
    expect(formClosedReason({ closesAt: T0 + 1, maxSubmissions: 3 }, 2, T0)).toBeNull();
    expect(formClosedReason({ closesAt: null, maxSubmissions: null }, 99, T0)).toBeNull();
  });
});
