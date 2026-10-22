import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, hmacHex } from "./crypto";
import { verifySignature } from "./instagram";

describe("인스타그램 보안 헬퍼", () => {
  it("토큰 암호화 왕복, 매번 다른 암호문", async () => {
    const a = await encryptToken("k", "token-123");
    expect(a).not.toBe(await encryptToken("k", "token-123"));
    expect(await decryptToken("k", a)).toBe("token-123");
    await expect(decryptToken("other", a)).rejects.toThrow();
  });
  it("웹훅 서명 검증", async () => {
    const env = { META_APP_SECRET: "s" } as Env;
    const raw = '{"entry":[]}';
    expect(await verifySignature(env, raw, `sha256=${await hmacHex("s", raw)}`)).toBe(true);
    expect(await verifySignature(env, raw, "sha256=deadbeef")).toBe(false);
    expect(await verifySignature(env, raw, undefined)).toBe(false);
  });
});
