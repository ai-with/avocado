export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

type ErrorBody = { error?: { code?: string; message?: string; fields?: Record<string, string> } };
type Options = { redirectOn401?: boolean };

async function request<T>(method: string, path: string, body?: unknown, opts: Options = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data: unknown = await res.json().catch(() => null);
  if (res.ok) return data as T;

  if (res.status === 401 && opts.redirectOn401 !== false) {
    const next = location.pathname + location.search;
    location.assign(`/login?next=${encodeURIComponent(next)}`);
  }
  const err = (data as ErrorBody | null)?.error;
  // 휴대폰 인증 전 계정은 인증 화면으로 보낸다
  if (res.status === 403 && err?.code === "phone_required" && opts.redirectOn401 !== false && location.pathname !== "/verify-phone") {
    location.assign(`/verify-phone?next=${encodeURIComponent(location.pathname + location.search)}`);
  }
  throw new ApiError(res.status, err?.code ?? "unknown", err?.message ?? "요청을 처리하지 못했어요.", err?.fields);
}

// 401 이면 로그인 화면으로 보낸다. 공개 화면에서는 { redirectOn401: false } 를 넘긴다
export const api = {
  get: <T>(path: string, opts?: Options) => request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: Options) => request<T>("POST", path, body ?? {}, opts),
  patch: <T>(path: string, body: unknown, opts?: Options) => request<T>("PATCH", path, body, opts),
  del: <T>(path: string, opts?: Options) => request<T>("DELETE", path, undefined, opts),
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "알 수 없는 오류가 발생했어요.");
