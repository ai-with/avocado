import { describe, expect, it } from "vitest";
import { z } from "zod";
import { hashPassword, verifyPassword } from "./password";
import { base64url, fromBase64url, newToken } from "./ids";
import { ApiError, parse } from "./errors";

describe("password", () => {
  it("해시 후 같은 비밀번호만 통과한다", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored.startsWith("pbkdf2-sha256$100000$")).toBe(true);
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("ids", () => {
  it("newToken 은 url 안전 문자와 지정 길이", () => {
    expect(newToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newToken(16)).toHaveLength(22);
  });
  it("base64url 왕복", () => {
    const bytes = Uint8Array.from([0, 250, 251, 252, 253, 254, 255]);
    expect([...fromBase64url(base64url(bytes))]).toEqual([...bytes]);
  });
});

describe("parse", () => {
  it("검증 실패 시 필드별 메시지를 담은 ApiError", () => {
    const schema = z.object({ email: z.email("이메일 형식이 아니에요.") });
    try {
      parse(schema, { email: "nope" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).fields).toEqual({ email: "이메일 형식이 아니에요." });
    }
  });
});
