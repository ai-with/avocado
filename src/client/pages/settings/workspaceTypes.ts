import type { Role } from "../../../shared/roles";

export type Member = { userId: string; name: string; email: string; role: Role; joinedAt: number };
export type Invite = { id: string; email: string; role: Role; expiresAt: number; url: string };
export type InviteResult = { invite: Invite; email: { delivered: boolean } };
export const ASSIGNABLE: Role[] = ["editor", "approver", "viewer"];
export const INVITE_COPIED = "초대 링크를 복사했습니다.";
// 결과 토스트를 띄우고 목록을 다시 불러오는 공통 실행기
export type Act = (fn: () => Promise<unknown>, done: string) => Promise<void>;
