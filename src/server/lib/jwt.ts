import { fromBase64url } from "./ids";

export type Jwk = JsonWebKey & { kid?: string };
export type JwtClaims = Record<string, unknown>;

const text = (b: Uint8Array) => new TextDecoder().decode(b);

// RS256 서명만 검증한다. 클레임 확인은 호출자가 한다. 실패하면 Error
export async function verifyRs256(token: string, keys: Jwk[]): Promise<JwtClaims> {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) throw new Error("jwt_malformed");
  const header = JSON.parse(text(fromBase64url(h))) as { alg?: string; kid?: string };
  if (header.alg !== "RS256") throw new Error("jwt_alg");
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("jwt_kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("jwt_signature");
  return JSON.parse(text(fromBase64url(p))) as JwtClaims;
}

export type GoogleClaims = { sub: string; email: string; emailVerified: boolean; name: string };
const GOOGLE_ISS = ["https://accounts.google.com", "accounts.google.com"];
const SKEW_S = 60;

// 구글 id_token: 서명 + iss/aud/exp/nonce 확인
export async function verifyGoogleIdToken(
  token: string,
  opts: { keys: Jwk[]; clientId: string; nonce: string; nowSec: number },
): Promise<GoogleClaims> {
  const c = await verifyRs256(token, opts.keys);
  if (!GOOGLE_ISS.includes(String(c.iss))) throw new Error("jwt_iss");
  if (c.aud !== opts.clientId) throw new Error("jwt_aud");
  if (typeof c.exp !== "number" || c.exp + SKEW_S < opts.nowSec) throw new Error("jwt_exp");
  if (c.nonce !== opts.nonce) throw new Error("jwt_nonce");
  if (typeof c.sub !== "string" || typeof c.email !== "string") throw new Error("jwt_claims");
  return {
    sub: c.sub,
    email: c.email.toLowerCase(),
    emailVerified: c.email_verified === true || c.email_verified === "true",
    name: typeof c.name === "string" && c.name ? c.name : c.email.split("@")[0]!,
  };
}

// ponytail: isolate 메모리 캐시 1시간. 키 회전 시 kid 미일치면 한 번 새로 받는다
let cache: { keys: Jwk[]; at: number } | null = null;
export async function googleKeys(force = false): Promise<Jwk[]> {
  if (!force && cache && Date.now() - cache.at < 3600_000) return cache.keys;
  const res = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const data: { keys: Jwk[] } = await res.json();
  cache = { keys: data.keys, at: Date.now() };
  return data.keys;
}

// 콜백에서 찾은 기존 계정으로 할 일을 정한다
export type GoogleAction = "login" | "link" | "create" | "email_unverified";
export function googleAction(bySub: boolean, byEmail: boolean, emailVerified: boolean): GoogleAction {
  if (bySub) return "login";
  if (byEmail) return emailVerified ? "link" : "email_unverified";
  return "create";
}
