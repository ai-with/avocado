// 계약 마감 카운트다운 (TASK-074). 화면은 이 결과만 그린다

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// 계약 종료일이 먼저, 없으면 가이드의 초안 마감, 둘 다 없으면 null
export function pickDeadline(contractEndAt: number | null, guideDeadlineAt: number | null): number | null {
  return contractEndAt ?? guideDeadlineAt ?? null;
}

export type Countdown = { date: string; past: boolean; days: number; clock: string };

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

// 날짜는 브라우저 현지 시간 YYYY.MM.DD
export function formatDeadlineDate(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

// 남은 전체 일수와, 일수를 뺀 나머지 시:분:초.밀리초
export function countdown(deadlineAt: number, nowMs: number): Countdown {
  const left = deadlineAt - nowMs;
  const date = formatDeadlineDate(deadlineAt);
  if (left <= 0) return { date, past: true, days: 0, clock: "00:00:00.000" };
  const rest = left % DAY;
  const clock = `${pad(Math.floor(rest / HOUR))}:${pad(Math.floor((rest % HOUR) / MINUTE))}:${pad(Math.floor((rest % MINUTE) / SECOND))}.${pad(rest % SECOND, 3)}`;
  return { date, past: false, days: Math.floor(left / DAY), clock };
}
