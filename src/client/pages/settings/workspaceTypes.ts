import { ROLE_LABELS, type Role } from "../../../shared/roles";

export type Member = { userId: string; name: string; email: string; role: Role; joinedAt: number };
export type Invite = { id: string; email: string; role: Role; expiresAt: number; url: string };
export type InviteResult = { invite: Invite; email: { delivered: boolean } };
export const ASSIGNABLE: Role[] = ["editor", "approver", "viewer"];
const ROLE_SCOPE: Partial<Record<Role, string>> = { editor: "가이드·검수·발송", approver: "최종 승인", viewer: "성과·리드 보기" };
// 역할 선택칸 선택지. 설명 줄에 할 수 있는 일을 적는다
export const ROLE_OPTIONS = ASSIGNABLE.map((r) => ({ value: r, label: ROLE_LABELS[r], description: ROLE_SCOPE[r] }));
export const INVITE_COPIED = "초대 링크를 복사했어요.";
// 결과 토스트를 띄우고 목록을 다시 불러오는 공통 실행기
export type Act = (fn: () => Promise<unknown>, done: string) => Promise<void>;
