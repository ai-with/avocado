import type { KeywordDmSendStatus } from "../../../shared/performance";

export type Rule = {
  id: string;
  guideId: string | null;
  influencerId: string | null;
  igMediaId: string;
  mediaThumbUrl: string | null;
  mediaPermalink: string | null;
  keywords: string[];
  message: string;
  publicReplyVariants: string[];
  status: "on" | "off" | "paused";
  pausedReason: string | null;
  guideName: string | null;
  influencerName: string | null;
  todaySent: number;
  clicks: number;
  leads: number;
  linkUrl: string | null;
};
export type KdmData = { configured: boolean; connection: { username: string | null; connected: boolean; expired: boolean; disconnected: boolean; reason: string | null } | null; defaultPublicReplies: string[]; rules: Rule[] };
export type Media = { id: string; caption?: string; permalink: string; thumbnail_url?: string; media_url?: string; timestamp: string };
export type Send = { id: string; username: string | null; commentText: string | null; commentAt: number; sentAt: number | null; status: KeywordDmSendStatus; reason: string | null };
export type Act = (fn: () => Promise<unknown>, done: string) => Promise<void>;

export const STATUS: Record<Rule["status"], [string, "success" | "neutral" | "warn"]> = { on: ["켜짐", "success"], off: ["꺼짐", "neutral"], paused: ["일시정지", "warn"] };
