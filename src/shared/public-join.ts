// 공개 가이드에 필요한 클라이언트 설정만 반환한다. 검증 secret은 서버에만 둔다.
export type PublicJoinChallenge = { siteKey: string | null; action: "guide_join"; cData: string };
export type PublicJoinRequest = { displayName: string; igHandle: string; email: string; lang: "ko" | "en"; turnstileToken: string };
