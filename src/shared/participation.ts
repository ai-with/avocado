import { withJosa } from "./josa";

// 인플루언서별 진행 상태·조건·참여 회차 (TASK-072, AIWITH-489). 서버와 화면이 같이 쓴다

export const PARTICIPATION_STATUSES = ["contact", "progress", "review", "done", "stopped"] as const;
export type ParticipationStatus = (typeof PARTICIPATION_STATUSES)[number];

export const STATUS_LABEL: Record<ParticipationStatus, string> = { contact: "컨택", progress: "진행", review: "검수", done: "완료", stopped: "중단" };

// 앞으로만 가는 순서. 중단은 순서 밖이라 어떤 사건이 와도 다시 앞으로 갈 수 있게 가장 낮게 둔다
const RANK: Record<ParticipationStatus, number> = { stopped: -1, contact: 0, progress: 1, review: 2, done: 3 };

// guide_influencers.stage → 상태. 마이그레이션 0018 의 UPDATE 와 같은 규칙이다
const STAGE_STATUS: Record<string, ParticipationStatus> = {
  invited: "contact",
  viewed: "contact",
  consented: "progress",
  uploaded: "review",
  feedback_sent: "review",
  approved: "done",
  withdrawn: "stopped",
};
export const statusFromStage = (stage: string): ParticipationStatus => STAGE_STATUS[stage] ?? "contact";

// 공개 화면·검수에서 생기는 사건 → 목표 상태
const EVENT_STATUS: Record<string, ParticipationStatus> = {
  participation_accepted: "progress",
  upload_completed: "review",
  final_approved: "done",
  consent_withdrawn: "stopped",
};
export const statusForEvent = (eventName: string): ParticipationStatus | null => EVENT_STATUS[eventName] ?? null;

// 자동 전이: 앞으로만. 동의 철회(중단)는 언제나 적용한다. 바뀌지 않으면 null
export function nextAutoStatus(current: ParticipationStatus, target: ParticipationStatus): ParticipationStatus | null {
  if (current === target) return null;
  if (target === "stopped") return "stopped";
  return RANK[target] > RANK[current] ? target : null;
}

// 참여 회차: 같은 인플루언서·같은 브랜드 안에서 캠페인 참여를 만든 순서(1회차, 2회차)
export type RoundKey = { id: string; influencerId: string; brandId: string; createdAt: number };
export function participationRounds(rows: RoundKey[]): Map<string, number> {
  const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const seen = new Map<string, number>();
  const out = new Map<string, number>();
  for (const r of sorted) {
    const key = `${r.influencerId}:${r.brandId}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    out.set(r.id, n);
  }
  return out;
}

// 조건. vars 는 다음 스토리(484)의 사용자 변수 값 자리
export type ParticipationTerms = { amount: number | null; currency: string; deliverables: string; memo: string; vars?: Record<string, string> };
export const EMPTY_TERMS: ParticipationTerms = { amount: null, currency: "KRW", deliverables: "", memo: "" };

export const CONTACT_LOG_KINDS = ["message", "status", "note", "system"] as const;
export type ContactLogKind = (typeof CONTACT_LOG_KINDS)[number];
export type ContactChannel = "dm" | "email";

// 사건 → 소통 이력 한 줄(system). 상태 변경 줄은 따로 쌓는다
const EVENT_LOG_TEXT: Record<string, string> = {
  participation_accepted: "인플루언서가 참여에 동의했어요",
  consent_withdrawn: "인플루언서가 동의를 철회했어요",
  upload_completed: "인플루언서가 영상을 올렸어요",
  review_round_submitted: "피드백을 보냈어요",
  final_approved: "최종 승인했어요",
  guide_email_sent: "가이드 링크를 이메일로 보냈어요",
};
export const logTextForEvent = (eventName: string): string | null => EVENT_LOG_TEXT[eventName] ?? null;

export const statusChangeText = (from: ParticipationStatus, to: ParticipationStatus, auto: boolean) =>
  `상태를 ${STATUS_LABEL[from]}에서 ${withJosa(STATUS_LABEL[to], "으로/로")} ${auto ? "자동으로 " : ""}바꿨어요`;
