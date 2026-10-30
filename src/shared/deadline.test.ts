import { describe, expect, it } from "vitest";
import { countdown, pickDeadline } from "./deadline";

const DAY = 86_400_000;
const at = (y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, mi, s, ms).getTime();

describe("pickDeadline", () => {
  it("계약 종료일 우선, 없으면 가이드 마감, 둘 다 없으면 null", () => {
    expect(pickDeadline(10, 20)).toBe(10);
    expect(pickDeadline(null, 20)).toBe(20);
    expect(pickDeadline(null, null)).toBeNull();
  });
});

describe("countdown", () => {
  it("남은 일수와 나머지 시:분:초.밀리초", () => {
    const end = at(2026, 11, 30);
    expect(countdown(end, end - (34 * DAY + 12 * 3_600_000 + 3 * 60_000 + 45_000 + 123))).toEqual({ date: "2026.11.30", past: false, days: 34, clock: "12:03:45.123" });
  });
  it("하루 안 남으면 D-0", () => {
    const end = at(2026, 11, 30, 18);
    expect(countdown(end, end - 5_000)).toMatchObject({ days: 0, clock: "00:00:05.000" });
  });
  it("정확히 하루 남은 자정 경계는 D-1 00:00:00.000", () => {
    const end = at(2026, 12, 1);
    expect(countdown(end, end - DAY)).toMatchObject({ date: "2026.12.01", days: 1, clock: "00:00:00.000" });
  });
  it("지나면 past", () => {
    const end = at(2026, 11, 30);
    expect(countdown(end, end)).toMatchObject({ past: true });
    expect(countdown(end, end + 1)).toMatchObject({ past: true });
  });
});
