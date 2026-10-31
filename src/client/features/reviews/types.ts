import type { DriveAccess, GuideRule } from "../../../shared/guides";
import type {
  CandidateConfidence,
  CandidateDecision,
  CandidateResult,
  DecisionReason,
  FeedbackShape,
  FeedbackSource,
  JobStage,
  JobStatus,
  ReviewState,
} from "../../../shared/review";

export type ReviewRow = {
  id: string;
  version: number;
  status: string;
  state: ReviewState;
  delayed: boolean;
  uploadedAt: number | null;
  driveUrl: string | null;
  driveAccess: DriveAccess | null;
  guide: { id: string; name: string };
  influencer: { id: string; displayName: string; igHandle: string | null; lang: "ko" | "en" };
  candidates: number;
  conflicts: number;
};

export type Job = { stage: JobStage; status: JobStatus; attempts: number; startedAt: number | null; finishedAt: number | null; error: string | null };
export type Frame = { id: string; tMs: number; source: string; url: string };
export type Segment = { id: string; startMs: number; endMs: number; lang: string; text: string; translatedText: string | null; translatedLang: string | null };
export type Candidate = {
  id: string;
  ruleId: string;
  ruleType: string;
  ruleContent: string;
  ruleVersion: number | null;
  result: CandidateResult;
  confidence: CandidateConfidence;
  frameIds: string[];
  segmentIds: string[];
  reason: string;
  modelVersion: string;
  decision: CandidateDecision | null;
  decisionReason: DecisionReason | null;
  decisionNote: string | null;
};
export type FeedbackItem = {
  id: string;
  submissionId: string;
  roundId: string | null;
  n: number | null;
  frameId: string | null;
  frameUrl: string | null;
  tMs: number;
  shape: FeedbackShape | null;
  text: string;
  textTranslated: string | null;
  source: FeedbackSource;
  influencerDone: boolean;
  reply: string | null;
  replyTranslated: string | null;
};
export type Round = { id: string; n: number; submissionId: string; version: number | null; submittedAt: number; items: FeedbackItem[] };

export type ReviewDetail = {
  mediaState?: "available" | "withdrawn" | "unavailable";
  submission: { id: string; version: number; kind: string; status: string; fileName: string | null; durationS: number | null; width: number | null; height: number | null; uploadedAt: number | null; driveUrl: string | null; driveAccess: DriveAccess | null; note: string | null; videoUrl: string | null; delayed: boolean };
  cleanUrl: string | null;
  guide: { id: string; name: string };
  influencer: { id: string; displayName: string; igHandle: string | null; lang: "ko" | "en" };
  giId: string;
  feedbackUrl: string;
  versions: { id: string; version: number; status: string; uploadedAt: number | null }[];
  jobs: Job[];
  frames: Frame[];
  segments: Segment[];
  candidates: Candidate[];
  rules: GuideRule[];
  drafts: FeedbackItem[];
  rounds: Round[];
  approval: { approvedAt: number; submissionId: string } | null;
  // 승인 뒤 새 버전 (340): afterApproval 이면 재승인하거나 기존 승인 유지로 닫을 수 있다
  approvedVersion: number | null;
  afterApproval: boolean;
  superseded: boolean;
  locked: boolean;
  // 판단이 엇갈린 후보·코멘트 id 와 그 장면 시각 (337)
  conflicts: { ids: string[]; times: number[] };
  content: { url: string; conflictUrl: string | null } | null;
  canApprove: boolean;
  canEdit: boolean;
};

// 검수 화면 섹션이 공유하는 실행기: 요청 → (성공 토스트) → 새로 읽기, 실패는 토스트
export type ActFn = (fn: () => Promise<unknown>, done?: string) => Promise<void>;
export type RuleStat = {
  ruleId: string;
  ruleType: string;
  ruleContent: string;
  decided: number;
  rejected: number;
  reasons: Record<DecisionReason, number>;
  notes: string[];
  editUrl: string;
  suggest: boolean;
};

export type SeekFn = (tMs: number) => void;
