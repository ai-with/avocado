import type { Db } from "./db";
import type { Role } from "../shared/roles";

export type AuthUser = { id: string; email: string; name: string };
// onboardedAt: 온보딩 설문을 마치거나 건너뛴 시각. null 이면 앱이 /onboarding 으로 보낸다
export type AuthWorkspace = { id: string; name: string; plan: string; onboardedAt: number | null };
// phone: E.164 원문(표시는 maskPhone). phoneVerified 가 false 면 인증 화면 외 API 는 403 phone_required
export type Auth = { sessionId: string; user: AuthUser; workspace: AuthWorkspace | null; role: Role | null; phone: string | null; phoneVerified: boolean };

export type AppEnv = { Bindings: Env; Variables: { db: Db; auth: Auth | null } };
