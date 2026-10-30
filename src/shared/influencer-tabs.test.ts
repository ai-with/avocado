import { describe, expect, it } from "vitest";
import { buildInfluencerTabs, countUnreadLatest } from "./influencer-tabs";

const tokens = { guideToken: "g1", uploadToken: "u1", feedbackToken: "f1" };

describe("buildInfluencerTabs", () => {
  it("동의 전이면 업로드·피드백이 잠긴다", () => {
    expect(buildInfluencerTabs(tokens, { consented: false, unreadFeedback: 3, deadlineAt: 5 })).toEqual({ guide: "/g/g1", upload: null, feedback: null, unreadFeedback: 0, deadlineAt: 5 });
  });
  it("동의 뒤에는 보낸 피드백이 없어도 피드백 탭이 열린다", () => {
    expect(buildInfluencerTabs(tokens, { consented: true, unreadFeedback: 0, deadlineAt: null })).toEqual({ guide: "/g/g1", upload: "/u/u1", feedback: "/f/f1", unreadFeedback: 0, deadlineAt: null });
  });
  it("미반영 수를 배지로 준다", () => {
    expect(buildInfluencerTabs(tokens, { consented: true, unreadFeedback: 2, deadlineAt: null }).unreadFeedback).toBe(2);
  });
});

describe("countUnreadLatest", () => {
  it("지난 버전 미반영은 세지 않는다", () => {
    const items = [{ version: 1, done: false }, { version: 2, done: false }, { version: 2, done: true }, { version: 2, done: false }];
    expect(countUnreadLatest(items, 2)).toBe(2);
    expect(countUnreadLatest([{ version: 1, done: false }], 2)).toBe(0);
  });
});
