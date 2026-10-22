import { describe, expect, it } from "vitest";
import { judgeCode, maskPhone, newCode, normalizePhone, toKrLocal } from "./phone";
import { googleAction, verifyGoogleIdToken, type Jwk } from "./jwt";
import { base64url } from "./ids";

describe("phone", () => {
  it("한국 휴대폰 번호를 E.164 로 바꾼다", () => {
    expect(normalizePhone("010-1234-5678")).toBe("+821012345678");
    expect(normalizePhone(" 010 1234 5678 ")).toBe("+821012345678");
    expect(normalizePhone("+82 10-1234-5678")).toBe("+821012345678");
    expect(normalizePhone("+82 010 1234 5678")).toBe("+821012345678");
    expect(normalizePhone("011-123-4567")).toBe("+82111234567");
    expect(normalizePhone("+1 (415) 555-0100")).toBe("+14155550100");
  });
  it("휴대폰이 아니거나 형식이 틀리면 null", () => {
    expect(normalizePhone("02-123-4567")).toBeNull();
    expect(normalizePhone("1012345678")).toBeNull();
    expect(normalizePhone("010-1234")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });
  it("마스킹과 국내 표기", () => {
    expect(maskPhone("+821012345678")).toBe("010-****-5678");
    expect(toKrLocal("+821012345678")).toBe("01012345678");
  });
  it("인증번호는 6자리 숫자", () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });
});

describe("judgeCode", () => {
  const base = { attempts: 0, expiresAt: 10_000, verifiedAt: null, codeHash: "h" };
  it("맞으면 ok, 틀리면 mismatch", () => {
    expect(judgeCode(base, "h", 5_000)).toBe("ok");
    expect(judgeCode(base, "x", 5_000)).toBe("mismatch");
  });
  it("만료, 5회 초과, 이미 사용", () => {
    expect(judgeCode(base, "h", 10_001)).toBe("expired");
    expect(judgeCode({ ...base, attempts: 4 }, "h", 5_000)).toBe("ok");
    expect(judgeCode({ ...base, attempts: 5 }, "h", 5_000)).toBe("too_many");
    expect(judgeCode({ ...base, verifiedAt: 1 }, "h", 5_000)).toBe("used");
  });
});

// 테스트용 RSA 키 쌍과 서명 함수
const enc = (o: object) => base64url(new TextEncoder().encode(JSON.stringify(o)));
async function setup() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = { ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as Jwk), kid: "k1" };
  const sign = async (claims: object, kid = "k1") => {
    const input = `${enc({ alg: "RS256", kid })}.${enc(claims)}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(input));
    return `${input}.${base64url(new Uint8Array(sig))}`;
  };
  return { keys: [jwk], sign };
}
const nowSec = 1_800_000_000;
const claims = { iss: "https://accounts.google.com", aud: "cid", exp: nowSec + 300, nonce: "n1", sub: "g-1", email: "A@Example.com", email_verified: true, name: "에이" };
const opts = { clientId: "cid", nonce: "n1", nowSec };

describe("google id_token", () => {
  it("올바른 토큰이면 클레임을 돌려준다", async () => {
    const { keys, sign } = await setup();
    const g = await verifyGoogleIdToken(await sign(claims), { ...opts, keys });
    expect(g).toEqual({ sub: "g-1", email: "a@example.com", emailVerified: true, name: "에이" });
  });
  it("서명, aud, iss, exp, nonce, kid 가 틀리면 거절", async () => {
    const { keys, sign } = await setup();
    const other = await setup();
    await expect(verifyGoogleIdToken(await other.sign(claims), { ...opts, keys })).rejects.toThrow("jwt_signature");
    await expect(verifyGoogleIdToken(await sign({ ...claims, aud: "x" }), { ...opts, keys })).rejects.toThrow("jwt_aud");
    await expect(verifyGoogleIdToken(await sign({ ...claims, iss: "https://evil" }), { ...opts, keys })).rejects.toThrow("jwt_iss");
    await expect(verifyGoogleIdToken(await sign({ ...claims, exp: nowSec - 120 }), { ...opts, keys })).rejects.toThrow("jwt_exp");
    await expect(verifyGoogleIdToken(await sign({ ...claims, nonce: "n2" }), { ...opts, keys })).rejects.toThrow("jwt_nonce");
    await expect(verifyGoogleIdToken(await sign(claims, "k2"), { ...opts, keys })).rejects.toThrow("jwt_kid");
    const [h, p] = (await sign(claims)).split(".");
    await expect(verifyGoogleIdToken(`${h}.${p}.`, { ...opts, keys })).rejects.toThrow("jwt_malformed");
  });
  it("콜백 분기: sub 일치 로그인, 검증된 같은 이메일은 연결, 아니면 거절, 없으면 임시 가입", () => {
    expect(googleAction(true, false, false)).toBe("login");
    expect(googleAction(false, true, true)).toBe("link");
    expect(googleAction(false, true, false)).toBe("email_unverified");
    expect(googleAction(false, false, true)).toBe("create");
  });
});
