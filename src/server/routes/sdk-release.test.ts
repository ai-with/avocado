import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import { assertRelease, describeRelease, readManifest } from "../../../sdk/scripts/releases";

describe("추적된 불변 SDK release", () => {
  it("보존한 v1.0.0 두 파일은 운영 baseline과 정확히 일치한다", () => {
    const expected = { js: "16f50add2dbefeea1aa9e68cc2b6df96899bb1f3ecba7de4d90d53dd32e2c5e5", mjs: "55a48449c592f41ecf0ae41b1461ea8076214d668dc76153106e3d66049b5887" };
    for (const [extension, sha256] of Object.entries(expected)) {
      const bytes = readFileSync(new NodeURL(`../../../sdk/releases/v1.0.0.${extension}`, import.meta.url));
      expect(describeRelease(bytes).sha256).toBe(sha256);
    }
  });
  it("모든 manifest 파일의 크기·SHA256·SRI를 검증하고 1byte 변경도 거부한다", () => {
    for (const [name, expected] of Object.entries(readManifest().files)) {
      const bytes = readFileSync(new NodeURL(`../../../sdk/releases/${name}`, import.meta.url));
      expect(() => assertRelease(name, bytes, expected)).not.toThrow();
      const changed = bytes.slice(); changed[0] = changed[0]! ^ 1;
      expect(() => assertRelease(name, changed, expected)).toThrow("SDK release mismatch");
    }
  });
});
