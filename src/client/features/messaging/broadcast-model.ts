import { REASON_LABELS, type Audience, type Channel, type MessageKind, type MessageTemplate, type SkipReason } from "../../../shared/messaging";
import { EMPTY_EMAIL } from "./common";

export type Status = "draft" | "scheduled" | "sending" | "sent";
export type Draft = { name: string; channel: Channel; kind: MessageKind; audience: Audience; template: MessageTemplate };
export type BroadcastStats = { eligible: number; sent: number; skipped: number; reasons: Record<string, number> };
export type Broadcast = Draft & { id: string; status: Status; scheduledAt: number | null; sentAt: number | null; updatedAt: number; stats: BroadcastStats | null };
export type Count = { total: number; eligible: number; reasons: Partial<Record<SkipReason, number>> };
export type Named = { id: string; name: string };
export type Group = Named & { count: number };

export const STATUS_LABELS: Record<Status, string> = { draft: "임시저장", scheduled: "예약됨", sending: "보내는 중", sent: "보냄" };
export const NEW: Draft = { name: "", channel: "email", kind: "info", audience: { groupIds: [], tagIds: [] }, template: EMPTY_EMAIL };
export const reasonText = (r: Record<string, number>) => Object.entries(r).map(([k, n]) => `${REASON_LABELS[k as SkipReason] ?? k} ${n}명`).join(", ");
export const resultText = (s: BroadcastStats) => `${s.sent}명 보냄${s.skipped ? ` · 제외 ${s.skipped}명 (${reasonText(s.reasons)})` : ""}`;
