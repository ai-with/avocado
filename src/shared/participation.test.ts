import { describe, expect, it } from "vitest";
import { nextAutoStatus, participationRounds, statusChangeText, statusForEvent, statusFromStage } from "./participation";

describe("stage → 상태", () => {
  it("열람 전후는 컨택, 동의는 진행, 업로드·피드백은 검수, 승인은 완료, 철회는 중단", () => {
    expect(statusFromStage("invited")).toBe("contact");
    expect(statusFromStage("viewed")).toBe("contact");
    expect(statusFromStage("consented")).toBe("progress");
    expect(statusFromStage("uploaded")).toBe("review");
    expect(statusFromStage("feedback_sent")).toBe("review");
    expect(statusFromStage("approved")).toBe("done");
    expect(statusFromStage("withdrawn")).toBe("stopped");
    expect(statusFromStage("unknown")).toBe("contact");
  });
});

describe("자동 전이는 앞으로만", () => {
  it("사건마다 목표 상태가 있다", () => {
    expect(statusForEvent("participation_accepted")).toBe("progress");
    expect(statusForEvent("upload_completed")).toBe("review");
    expect(statusForEvent("final_approved")).toBe("done");
    expect(statusForEvent("consent_withdrawn")).toBe("stopped");
    expect(statusForEvent("guide_link_opened")).toBeNull();
  });

  it("앞으로는 가고, 뒤로는 가지 않는다", () => {
    expect(nextAutoStatus("contact", "progress")).toBe("progress");
    expect(nextAutoStatus("progress", "review")).toBe("review");
    expect(nextAutoStatus("contact", "done")).toBe("done");
    // 마케터가 완료로 바꾼 뒤 새 업로드가 와도 검수로 되돌리지 않는다
    expect(nextAutoStatus("done", "review")).toBeNull();
    expect(nextAutoStatus("review", "progress")).toBeNull();
    expect(nextAutoStatus("review", "review")).toBeNull();
  });

  it("철회는 언제나 중단, 중단 뒤 다시 동의하면 진행", () => {
    expect(nextAutoStatus("done", "stopped")).toBe("stopped");
    expect(nextAutoStatus("stopped", "stopped")).toBeNull();
    expect(nextAutoStatus("stopped", "progress")).toBe("progress");
  });

  it("이력 문구는 받침에 맞는 조사를 쓴다", () => {
    expect(statusChangeText("contact", "progress", true)).toBe("상태를 컨택에서 진행으로 자동으로 바꿨어요");
    expect(statusChangeText("review", "done", false)).toBe("상태를 검수에서 완료로 바꿨어요");
  });
});

describe("참여 회차", () => {
  it("같은 인플루언서·같은 브랜드 안에서 만든 순서대로 1회차, 2회차", () => {
    const rounds = participationRounds([
      { id: "b", influencerId: "dal", brandId: "demo", createdAt: 200 },
      { id: "a", influencerId: "dal", brandId: "demo", createdAt: 100 },
      { id: "c", influencerId: "dal", brandId: "orange", createdAt: 150 },
      { id: "d", influencerId: "haru", brandId: "demo", createdAt: 300 },
    ]);
    expect(rounds.get("a")).toBe(1);
    expect(rounds.get("b")).toBe(2);
    expect(rounds.get("c")).toBe(1);
    expect(rounds.get("d")).toBe(1);
  });
});
