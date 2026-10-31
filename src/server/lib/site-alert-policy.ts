import type { SiteAlertEvaluation, SiteAlertPolicy } from "../../shared/site-alerts";

export const ALERT_DAY_MS = 86_400_000;
export const ALERT_COOLDOWN_MS = 7 * ALERT_DAY_MS;
export const ALERT_RETENTION_MS = 30 * ALERT_DAY_MS;
export const alertDay = (at: number) => new Date(at + 9 * 3_600_000).toISOString().slice(0, 10);
export const alertDayStart = (day: string) => Date.parse(`${day}T00:00:00+09:00`);
export const shiftAlertDay = (day: string, days: number) => alertDay(alertDayStart(day) + days * ALERT_DAY_MS);
export function nextAlertCheck(at: number, immediate = false) {
  const today = alertDayStart(alertDay(at)) + 9 * 3_600_000;
  return at < today ? today : immediate ? at : today + ALERT_DAY_MS;
}
export function evaluateSiteAlert(policy: SiteAlertPolicy, firstEventAt: number | null, counts: { day: string; n: number }[], at: number): SiteAlertEvaluation {
  const targetDay = shiftAlertDay(alertDay(at), -1), targetStart = shiftAlertDay(targetDay, 1 - policy.confirmationDays);
  const baselineStart = shiftAlertDay(targetStart, -7), baselineEnd = shiftAlertDay(targetStart, -1);
  const byDay = new Map(counts.map(({ day, n }) => [day, n]));
  const target = Array.from({ length: policy.confirmationDays }, (_, i) => byDay.get(shiftAlertDay(targetStart, i)) ?? 0);
  const weekdays = Array.from({ length: policy.confirmationDays }, (_, i) => byDay.get(shiftAlertDay(targetStart, i - 7)) ?? 0);
  const baseline = Array.from({ length: 7 }, (_, i) => byDay.get(shiftAlertDay(baselineStart, i)) ?? 0);
  const baselineSum = baseline.reduce((sum, n) => sum + n, 0);
  const result = (kind: SiteAlertEvaluation["result"], reason: string): SiteAlertEvaluation => ({ result: kind, reason, targetDay, targetStart, baselineStart, baselineEnd, baselineSum, target, weekdays });
  if (firstEventAt === null || !Number.isFinite(firstEventAt) || firstEventAt > alertDayStart(baselineStart)) return result("insufficient", "history");
  if (![baselineSum, ...baseline, ...target, ...weekdays].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 700)) return result("insufficient", "invalid_counts");
  if (baselineSum < 7 * policy.minimumAverage || baselineSum === 0) return result("insufficient", "baseline");
  if (!target.every((n) => n * 700 <= baselineSum * policy.ratioPercent)) return result("normal", "ratio");
  if (!weekdays.every((n) => n > 0)) return result("insufficient", "weekday");
  if (!target.every((n, i) => n * 100 <= weekdays[i]! * policy.ratioPercent)) return result("normal", "weekday_ratio");
  return result("low", "drop");
}
