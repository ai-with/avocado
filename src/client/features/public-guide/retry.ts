import { ApiError } from "../../lib/api";

// 끊긴 연결 다시 시도 (AIWITH-377). 1, 2, 4, 8, 16, 30, 30, 30초, 합쳐 2분 남짓 기다린 뒤 멈춘다
export const RETRY_BASE_MS = 1000;
export const RETRY_MAX_MS = 30_000;
export const MAX_RETRIES = 8;
const SERVER_ERROR = 500;

// part 요청이 5xx 로 실패했을 때. 4xx 는 다시 해도 같으니 다시 시도하지 않는다
export class RetryableError extends Error {}

export const backoffMs = (attempt: number) => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);

// fetch 는 연결이 끊기면 TypeError 를 던진다
export const isRetryable = (e: unknown) => e instanceof TypeError || e instanceof RetryableError || (e instanceof ApiError && e.status >= SERVER_ERROR);

// 기다리는 시간이 끝나거나 다시 온라인이 되면 바로 깨어난다
function waitForRetry(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    window.addEventListener("online", done);
  });
}

// onRetry(true) 는 다시 시도하는 중, onRetry(false) 는 다시 붙었을 때
export async function withRetry<T>(run: () => Promise<T>, onRetry: (retrying: boolean) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await run();
      onRetry(false);
      return result;
    } catch (e) {
      if (!isRetryable(e) || attempt >= MAX_RETRIES) throw e;
      onRetry(true);
      await waitForRetry(backoffMs(attempt));
    }
  }
}
