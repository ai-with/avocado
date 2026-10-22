import type { MissingReason, OffsetH, SnapshotPath, SnapshotStatus } from "../../../shared/performance";
import type { ContentFormat } from "../../../shared/review";

export type Snap = {
  status: SnapshotStatus;
  scheduledAt: number;
  capturedAt: number | null;
  path: SnapshotPath | null;
  views: number | null;
  likes: number | null;
  saved: number | null;
  shares: number | null;
  comments: number | null;
  missing: Partial<Record<string, MissingReason>>;
  delayed: boolean;
};
export type PerfRow = {
  contentId: string;
  guideId: string;
  guideName: string;
  influencerId: string;
  influencerName: string;
  igHandle: string | null;
  url: string;
  format: ContentFormat;
  postedAt: number | null;
  postedAtSource: "api" | "manual" | null;
  registeredAt: number;
  connected: boolean;
  snapshots: Partial<Record<OffsetH, Snap>>;
  clicks: number;
  leads: number;
};
export type Filters = { guides: { id: string; name: string }[]; influencers: { id: string; name: string }[] };
export type PerfQuery = { guideId: string; influencerId: string; format: string };
