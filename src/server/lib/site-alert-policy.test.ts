import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_ALERT_POLICY } from "../../shared/site-alerts";
import { alertDay, alertDayStart, evaluateSiteAlert, nextAlertCheck, shiftAlertDay } from "./site-alert-policy";

const NOW = Date.parse("2026-11-10T00:00:00Z"), first = alertDayStart("2026-10-01");
const policy = { ...DEFAULT_SITE_ALERT_POLICY, enabled: true };
const counts = () => Array.from({ length: 9 }, (_, i) => ({ day: shiftAlertDay("2026-11-01", i), n: i < 7 ? 100 : 10 }));
describe("site alert explicit completed-day policy", () => {
  it("uses seven complete baseline days, two targets and same weekdays, excluding today", () => {
    const result = evaluateSiteAlert(policy, first, [...counts(), { day: "2026-11-10", n: 999999 }], NOW);
    expect(result).toMatchObject({ result: "low", baselineStart: "2026-11-01", baselineEnd: "2026-11-07", targetStart: "2026-11-08", targetDay: "2026-11-09", baselineSum: 700, target: [10, 10], weekdays: [100, 100] });
  });
  it("fills absent days with zero only after installation predates the whole baseline", () => {
    const baselineOnly = counts().slice(0, 7);
    expect(evaluateSiteAlert(policy, first, baselineOnly, NOW)).toMatchObject({ result: "low", target: [0, 0] });
    expect(evaluateSiteAlert(policy, alertDayStart("2026-11-01") + 1, baselineOnly, NOW)).toMatchObject({ result: "insufficient", reason: "history" });
    expect(evaluateSiteAlert(policy, null, baselineOnly, NOW).reason).toBe("history");
  });
  it("threshold boundary is inclusive and both target days must pass", () => {
    const data = counts(); data[7]!.n = 20; data[8]!.n = 20;
    expect(evaluateSiteAlert(policy, first, data, NOW).result).toBe("low");
    data[8]!.n = 21; expect(evaluateSiteAlert(policy, first, data, NOW).result).toBe("normal");
  });
  it("zero/low baseline and invalid counts never become an alert", () => {
    expect(evaluateSiteAlert(policy, first, [], NOW)).toMatchObject({ result: "insufficient", reason: "baseline" });
    const data = counts(); data[0]!.n = -1; expect(evaluateSiteAlert(policy, first, data, NOW).reason).toBe("invalid_counts");
    data[0]!.n = 100; data[5]!.n = -1; expect(evaluateSiteAlert(policy, first, data, NOW).reason).toBe("invalid_counts");
    data[5]!.n = Number.MAX_SAFE_INTEGER; expect(evaluateSiteAlert(policy, first, data, NOW).reason).toBe("invalid_counts");
    expect(evaluateSiteAlert({ ...policy, minimumAverage: 101 }, first, counts(), NOW).reason).toBe("baseline");
  });
  it("normal weekend seasonality and a zero same-weekday reference are not drop alerts", () => {
    const data = counts(); data[0]!.n = 10; data[1]!.n = 10; data[2]!.n = 300;
    expect(evaluateSiteAlert(policy, first, data, NOW)).toMatchObject({ result: "normal", reason: "weekday_ratio" });
    data[0]!.n = 0; expect(evaluateSiteAlert(policy, first, data, NOW)).toMatchObject({ result: "insufficient", reason: "weekday" });
  });
  it.each([1, 3])("confirmation length %i keeps baseline and target periods separate", (confirmationDays) => {
    const result = evaluateSiteAlert({ ...policy, confirmationDays }, first, counts(), NOW);
    expect(result.target).toHaveLength(confirmationDays); expect(shiftAlertDay(result.baselineEnd, 1)).toBe(result.targetStart);
  });
  it("KST rollover and 09:00 checks are stable in UTC scheduling", () => {
    expect(alertDay(Date.parse("2026-11-09T15:00:00Z"))).toBe("2026-11-10");
    expect(nextAlertCheck(NOW - 1, true)).toBe(NOW); expect(nextAlertCheck(NOW, true)).toBe(NOW); expect(nextAlertCheck(NOW)).toBe(NOW + 86_400_000);
  });
});
