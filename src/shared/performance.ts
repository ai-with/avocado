// 성과(F-48, F-49)와 댓글 키워드 DM(F-64) 공용 상수·순수 함수. 서버와 클라이언트가 같이 쓴다
import type { ContentFormat } from "./review";

export const SNAPSHOT_OFFSETS = [24, 72, 168] as const;
export type OffsetH = (typeof SNAPSHOT_OFFSETS)[number];
export const OFFSET_LABELS: Record<OffsetH, string> = { 24: "24시간", 72: "3일", 168: "7일" };

export const HOUR = 3_600_000;
export const MINUTE = 60_000;
// 예정 + 30분 안이면 정시 (F-48)
export const ON_TIME_MS = 30 * MINUTE;
// api_error 는 15분 간격 4회 재시도 (첫 시도 포함 5회)
export const MAX_ATTEMPTS = 5;

export const METRICS = ["views", "likes", "saved", "shares", "comments", "reach", "reposts"] as const;
export type Metric = (typeof METRICS)[number];
export const MAIN_METRICS = ["views", "likes", "saved", "shares"] as const satisfies readonly Metric[];
export const METRIC_LABELS: Record<Metric, string> = { views: "뷰", likes: "좋아요", saved: "저장", shares: "공유", comments: "댓글", reach: "도달", reposts: "리포스트" };

export type MissingReason =
  | "not_connected"
  | "hidden_by_owner"
  | "deleted"
  | "private_or_unavailable"
  | "token_expired"
  | "api_error"
  | "not_supported"
  | "registered_late";
export const REASON_LABELS: Record<MissingReason, string> = {
  not_connected: "연결 필요",
  hidden_by_owner: "좋아요 숨김",
  deleted: "게시물 삭제됨",
  private_or_unavailable: "비공개 또는 조회 불가",
  token_expired: "연결 끊김",
  api_error: "일시 오류",
  not_supported: "지원 안 함",
  registered_late: "등록 늦음",
};

export type SnapshotPath = "connected" | "discovery";
export type SnapshotStatus = "scheduled" | "captured" | "missing" | "cancelled";
export const FORMAT_LABELS: Record<ContentFormat, string> = { reel: "릴스", feed: "피드", carousel: "캐러셀", story: "스토리", unknown: "알 수 없음" };

export type PlannedSnapshot = { offsetH: OffsetH; scheduledAt: number; status: "scheduled" | "missing"; reason: MissingReason | null };

// 게시 시각 기준 +24h/+72h/+168h. 등록이 그 시점(+허용 오차)보다 늦으면 지난 시점은 결측(보간 안 함)
export function planSnapshots(postedAt: number, registeredAt: number): PlannedSnapshot[] {
  return SNAPSHOT_OFFSETS.map((offsetH) => {
    const scheduledAt = postedAt + offsetH * HOUR;
    const late = registeredAt > scheduledAt + ON_TIME_MS;
    return { offsetH, scheduledAt, status: late ? "missing" : "scheduled", reason: late ? "registered_late" : null };
  });
}

export function delayInfo(scheduledAt: number, capturedAt: number): { delayed: boolean; delayMin: number } {
  const delayMin = Math.max(0, Math.round((capturedAt - scheduledAt) / MINUTE));
  return { delayed: capturedAt > scheduledAt + ON_TIME_MS, delayMin };
}

// api_error 뒤 다시 시도할지(다음 cron, 15분 뒤), 결측으로 닫을지
export const afterApiError = (attemptsSoFar: number): "retry" | "missing" => (attemptsSoFar < MAX_ATTEMPTS ? "retry" : "missing");

// 인스타그램 게시물 URL → shortcode, 형식 추정. /p/ 는 피드·캐러셀 구분 불가라 feed
export function parsePostUrl(url: string): { shortcode: string; format: ContentFormat } | null {
  const m = /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(p|reel|reels|tv|stories\/[A-Za-z0-9_.]+)\/([A-Za-z0-9_-]+)/i.exec(url);
  if (!m?.[1] || !m[2]) return null;
  const kind = m[1].toLowerCase();
  const format: ContentFormat = kind.startsWith("reel") || kind === "tv" ? "reel" : kind === "p" ? "feed" : "story";
  return { shortcode: m[2], format };
}

// 키워드 매칭: 대소문자·공백 무시, 단순 포함. 맞은 키워드를 돌려준다
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
export function matchKeyword(text: string, keywords: string[]): string | null {
  const t = norm(text);
  return keywords.find((k) => norm(k) !== "" && t.includes(norm(k))) ?? null;
}

// 비공개 답장 규칙 (C1-a)
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * HOUR;
export const PRIVATE_REPLY_HOURLY_LIMIT = 750;
export const DM_FOOTER = (brand: string) => `${brand} · 더 받지 않으려면 답장으로 알려 주세요`;
export const renderDm = (message: string, link: string, brand: string) => `${message.replaceAll("{link}", link)}\n\n${DM_FOOTER(brand)}`;
export const DEFAULT_PUBLIC_REPLIES = ["DM 보냈어요! 확인해 주세요", "메시지함을 확인해 주세요", "자료를 DM으로 보내 드렸어요"];

export type KeywordDmSendStatus = "sent" | "already_sent" | "expired" | "failed" | "queued";
export const SEND_STATUS_LABELS: Record<KeywordDmSendStatus, string> = { sent: "보냄", already_sent: "이미 보냄", expired: "기간 지남", failed: "실패", queued: "대기" };

export type IgTarget = "influencer" | "client_brand" | "brand_sender";
export const IG_SCOPES: Record<IgTarget, string[]> = {
  influencer: ["instagram_business_basic", "instagram_business_manage_insights"],
  client_brand: ["instagram_business_basic", "instagram_business_manage_insights"],
  brand_sender: ["instagram_business_basic", "instagram_business_manage_insights", "instagram_business_manage_comments", "instagram_business_manage_messages"],
};
