// 앱 안 알림 (AIWITH-290). 서버와 화면이 같이 쓰는 종류·응답 모양·시간 표시

export const NOTIFICATION_KINDS = ["participation_accepted", "consent_withdrawn", "upload_completed", "feedback_done"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** GET /api/notifications 가 돌려주는 최근 개수. 안 읽은 수도 이 안에서 센다 */
export const NOTIFICATION_LIST_LIMIT = 30;

export type NotificationItem = { id: string; kind: NotificationKind; title: string; linkPath: string; createdAt: number; read: boolean };
export type NotificationList = { items: NotificationItem[]; unread: number };

export const countUnread = (items: Pick<NotificationItem, "read">[]) => items.filter((i) => !i.read).length;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// "방금", "3분 전", "2시간 전", "4일 전". 일주일이 넘으면 날짜
export function relativeTime(at: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - at);
  if (diff < MINUTE) return "방금";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}일 전`;
  const d = new Date(at);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
