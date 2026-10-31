import type { GuideProduct, GuideRule, SecondaryUseScope, VideoGuide } from "../../../shared/guides";
import type { DictRule } from "../../../shared/brand-terms";
import type { ContactLogKind, ParticipationStatus, ParticipationTerms } from "../../../shared/participation";

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
  // TASK-079: 이번 캠페인에서 끈 사전 규칙 id
  brandTermExclusions: string[];
  generatedByModel: string | null;
  publishedAt: number | null;
  createdAt: number;
};
// 캠페인 = 브랜드 가이드 1:1 (TASK-070). 캠페인 id 는 가이드 id 와 같다
export type GuideCampaign = { id: string; name: string; status: "active" | "archived"; brandId: string; brandName: string; endsAt: number | null; archivedAt: number | null };
// 브랜드 검수 사전에서 들어오는 규칙 (TASK-079). rules 는 끄기 전 전체, excluded 는 이번 캠페인에서 끈 id
export type GuideDictionary = { brandId: string | null; rules: DictRule[]; excluded: string[] };
export type GuideResponse = { guide: Guide; campaign: GuideCampaign | null; rules: GuideRule[]; warnings: string[]; lineWarnings: string[]; dictionary: GuideDictionary; sharedUrl: string };

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
export type GuideInfluencerRow = Participation & {
  id: string;
  influencer: Influencer;
  stage: string;
  tokenExpiresAt: number;
  links: { guide: string; upload: string; feedback: string; connect: string };
  status: StageSummary;
};

export const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("ko-KR") : "");
export const fmtDateTime = (ms: number | null) => (ms ? new Date(ms).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "");

// TASK-072: 진행 상태·조건·회차·계약 기간, 소통 이력
export type ContactLog = { id: string; kind: ContactLogKind; channel: "dm" | "email" | null; body: string; createdAt: number };
export type Participation = { participationStatus: ParticipationStatus; terms: ParticipationTerms | null; round: number; contractStartAt: number | null; contractEndAt: number | null };
