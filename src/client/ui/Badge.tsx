import type { ReactNode } from "react";
import "./Badge.css";

export type BadgeTone = "neutral" | "accent" | "success" | "warn" | "danger" | "info";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
