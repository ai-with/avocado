import type { GuideProduct, GuideRule, SecondaryUseScope, VideoGuide } from "../../../shared/guides";

export type Guide = {
  id: string;
  name: string;
  slug: string;
  guidelineSetId: string | null;
  extraRules: GuideRule[];
  status: "draft" | "published";
  product: GuideProduct;
  purpose: string;
  lengthS: number | null;
  lang: "ko" | "en";
  deadlineAt: number | null;
  deliverables: { final: boolean; clean: boolean; note: string };
  secondaryUseScope: SecondaryUseScope;
  videoGuide: VideoGuide | null;
  generatedByModel: string | null;
  publishedAt: number | null;
  createdAt: number;
};
export type GuideResponse = { guide: Guide; rules: GuideRule[]; warnings: string[]; lineWarnings: string[]; sharedUrl: string };

export type RuleSet = { id: string; name: string; version: number; updatedAt: number; ruleCount: number };
export type RuleSetDetail = { set: { id: string; name: string; version: number }; rules: (GuideRule & { version: number })[]; warnings: string[] };

export type Influencer = {
  id: string;
  displayName: string;
  igHandle: string | null;
  threadsHandle: string | null;
  email: string | null;
  lang: "ko" | "en";
  country: string | null;
  guideCount?: number;
};

export type StageSummary = {
  viewedAt: number | null;
  viewCount: number;
  consentedAt: number | null;
  consentWithdrawnAt: number | null;
  uploadVersion: number | null;
  uploadStatus: string | null;
  reviewRounds: number | null;
  approved: boolean | null;
  postUrl: string | null;
  postConflictUrl?: string | null;
  connected: boolean | null;
  snapshots: number | null;
  leads: number | null;
};
export type GuideInfluencerRow = {
  id: string;
  influencer: Influencer;
  stage: string;
  tokenExpiresAt: number;
  links: { guide: string; upload: string; feedback: string; connect: string };
  status: StageSummary;
};

export const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("ko-KR") : "");
export const fmtDateTime = (ms: number | null) => (ms ? new Date(ms).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "");
