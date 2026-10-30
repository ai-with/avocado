import type { BadgeTone } from "../../ui";
import { PARTICIPATION_STATUSES, STATUS_LABEL, type ContactLogKind, type ParticipationStatus, type ParticipationTerms } from "../../../shared/participation";
import { fmtDate } from "./types";

// 인플루언서 진행 상태·조건 표시 (TASK-072). 캠페인 상세와 인플루언서 상세가 같이 쓴다

export const STATUS_TONE: Record<ParticipationStatus, BadgeTone> = { contact: "neutral", progress: "info", review: "warn", done: "success", stopped: "danger" };
export const STATUS_OPTIONS = PARTICIPATION_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] }));
export const LOG_KIND_LABEL: Record<ContactLogKind, string> = { message: "메시지", status: "상태", note: "메모", system: "기록" };
export const CURRENCIES = ["KRW", "USD"] as const;

export function amountText(terms: ParticipationTerms | null): string {
  if (!terms || terms.amount === null) return "";
  return terms.currency === "KRW" ? `${terms.amount.toLocaleString("ko-KR")}원` : `${terms.currency} ${terms.amount.toLocaleString("ko-KR")}`;
}

// 표 한 칸 요약: 금액 · 산출물
export const termsSummary = (terms: ParticipationTerms | null) => [amountText(terms), terms?.deliverables].filter(Boolean).join(" · ");

export function periodText(start: number | null, end: number | null): string {
  if (!start && !end) return "";
  return `${fmtDate(start) || "미정"} ~ ${fmtDate(end) || "미정"}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
// <input type="datetime-local"> 값(로컬 시각) ↔ ms
export function toLocalInput(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (v: string): number | null => (v ? new Date(v).getTime() : null);
