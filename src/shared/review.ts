// 처리 파이프라인·검수·피드백에서 서버와 클라이언트가 함께 쓰는 타입과 표시 문구 (F-60~F-62)

export const JOB_STAGES = ["transcribe", "translate", "detect", "notify"] as const;
export type JobStage = (typeof JOB_STAGES)[number];
export type JobStatus = "queued" | "running" | "done" | "failed" | "skipped";
export const STAGE_LABELS: Record<JobStage, string> = { transcribe: "음성 전사", translate: "번역", detect: "위반 후보 탐지", notify: "알림" };
export const JOB_STATUS_LABELS: Record<JobStatus, string> = { queued: "대기", running: "진행 중", done: "완료", failed: "실패", skipped: "건너뜀" };

export type CandidateResult = "candidate" | "needs_check" | "compliant" | "undetermined";
export type CandidateConfidence = "high" | "medium" | "low";
export type CandidateDecision = "adopted" | "rejected" | "held";
export type DecisionReason = "compliant" | "irrelevant" | "ambiguous" | "other";

// 4-3: "위반"이라고 단정하지 않는다
export const RESULT_LABELS: Record<CandidateResult, string> = { candidate: "위반 후보", needs_check: "확인 필요", compliant: "준수", undetermined: "판단 불가" };
export const CONFIDENCE_LABELS: Record<CandidateConfidence, string> = { high: "높음", medium: "중간", low: "낮음" };
export const DECISION_LABELS: Record<CandidateDecision, string> = { adopted: "채택", rejected: "기각", held: "보류" };
export const DECISION_REASON_LABELS: Record<DecisionReason, string> = { compliant: "실제 준수함", irrelevant: "관련 없음", ambiguous: "규칙이 모호함", other: "기타" };

export type FeedbackSource = "candidate" | "manual" | "missed";
// 좌표는 프레임 크기 대비 0~1 비율. arrow 는 (x, y) 에서 (x + w, y + h) 로 향한다
export type FeedbackShape = { type: "box" | "arrow"; x: number; y: number; w: number; h: number };

export type ContentFormat = "reel" | "feed" | "carousel" | "story" | "unknown";

// 검수함 상태 (검수함 탭)
// after_approval: 승인된 버전이 있는데 그 뒤에 올라온 버전, superseded: 그 버전을 '기존 승인 유지'로 닫음 (340)
export type ReviewState = "waiting" | "processing" | "needs_review" | "feedback_sent" | "approved" | "after_approval" | "superseded";
export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  waiting: "대기",
  processing: "처리 중",
  needs_review: "검수 필요",
  feedback_sent: "피드백 보냄",
  approved: "승인",
  after_approval: "승인 뒤 새 버전",
  superseded: "기존 승인 유지",
};

// 같은 장면에서 판단이 엇갈린 코멘트·후보 표시 (337)
export const CONFLICT_LABEL = "확인 필요: 판단 엇갈림";
// 이 시간 안의 판단끼리 같은 장면으로 본다
export const CONFLICT_WINDOW_MS = 1000;
// 시각 목록 중 하나와 가까운가 (프레임에 배지 붙일 때)
export const nearAny = (tMs: number, times: number[]) => times.some((t) => Math.abs(t - tMs) <= CONFLICT_WINDOW_MS);

// 15분 넘게 ready 가 아니면 '처리 지연' (F-60)
export const PROCESSING_DELAY_MS = 15 * 60 * 1000;

export function fmtTimecode(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// 인스타그램 게시물 URL 에서 형식 추정. 캐러셀은 URL 로 알 수 없어 feed 로 둔다
export function contentFormatOf(url: string): ContentFormat {
  if (/\/reels?\//.test(url)) return "reel";
  if (/\/stories\//.test(url)) return "story";
  if (/\/p\//.test(url)) return "feed";
  return "unknown";
}
