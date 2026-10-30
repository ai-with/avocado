import type { ReactNode } from "react";
import "./Badge.css";

export type BadgeTone = "neutral" | "accent" | "success" | "warn" | "danger" | "info";
export type BadgeSize = "xs" | "sm" | "md" | "lg";

// 크기 4단 = TDS Badge xsmall·small·medium·large. 기본 sm(24)은 표·목록 안에 맞는 크기
export function Badge({ tone = "neutral", size = "sm", dot, children }: { tone?: BadgeTone; size?: BadgeSize; dot?: boolean; children: ReactNode }) {
  return <span className={`badge badge-${size} badge-${tone} ${dot ? "badge-dot" : ""}`}>{children}</span>;
}
