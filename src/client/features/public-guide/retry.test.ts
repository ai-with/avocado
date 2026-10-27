import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api";
import { MAX_RETRIES, RETRY_BASE_MS, RETRY_MAX_MS, RetryableError, backoffMs, isRetryable } from "./retry";

describe("backoffMs", () => {
  it("두 배씩 늘다가 상한에서 멈춘다", () => {
    expect([0, 1, 2, 3, 4].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(backoffMs(5)).toBe(RETRY_MAX_MS);
    expect(backoffMs(MAX_RETRIES)).toBe(RETRY_MAX_MS);
    expect(backoffMs(0)).toBe(RETRY_BASE_MS);
  });
});

describe("isRetryable", () => {
  it("연결 끊김과 5xx 만 다시 시도한다", () => {
    expect(isRetryable(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryable(new RetryableError("part_5xx"))).toBe(true);
    expect(isRetryable(new ApiError(503, "unavailable", "x"))).toBe(true);
    expect(isRetryable(new ApiError(409, "not_uploading", "x"))).toBe(false);
    expect(isRetryable(new Error("part_failed"))).toBe(false);
  });
});
