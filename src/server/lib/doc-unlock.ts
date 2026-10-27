import { hmacHex, safeEqual } from "./crypto";

// 게이트 통과 증표(열람 토큰). 형식: <documentId>.<leadId>.<만료 ms>.<HMAC>
// 서버에 저장하지 않고 서명만 확인한다. 브라우저가 localStorage 에 두고 새로고침 때 다시 보낸다

export const UNLOCK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ponytail: TOKEN_ENC_KEY 가 없는 로컬 개발에서만 고정 키로 서명한다(인스타 state 서명과 같은 방식)
export const unlockSecret = (env: Env) => env.TOKEN_ENC_KEY || "dev-only-doc-unlock-secret";

export async function signUnlock(secret: string, documentId: string, leadId: string, nowMs: number): Promise<string> {
  const body = `${documentId}.${leadId}.${nowMs + UNLOCK_TTL_MS}`;
  return `${body}.${await hmacHex(secret, body)}`;
}

// 맞는 자료의, 만료 전, 위조되지 않은 토큰이면 리드 id 를 돌려준다
export async function verifyUnlock(secret: string, token: string | undefined, documentId: string, nowMs: number): Promise<string | null> {
  const parts = (token ?? "").split(".");
  if (parts.length !== 4) return null;
  const [docId, leadId, exp, sig] = parts as [string, string, string, string];
  if (docId !== documentId || !leadId || !(Number(exp) > nowMs)) return null;
  return safeEqual(sig, await hmacHex(secret, `${docId}.${leadId}.${exp}`)) ? leadId : null;
}
