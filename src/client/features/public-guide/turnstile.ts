export type TurnstileOptions = {
  sitekey: string; action: string; cData: string; language: string; size: "flexible";
  retry: "never"; "refresh-expired": "manual"; "refresh-timeout": "manual"; "response-field": false;
  callback: (token: string) => void;
  "error-callback": () => boolean;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  "unsupported-callback": () => void;
};
export type TurnstileApi = { render: (element: HTMLElement, options: TurnstileOptions) => string; reset: (id: string) => void; remove: (id: string) => void; ready?: (callback: () => void) => void };
declare global { interface Window { turnstile?: TurnstileApi } }

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;
const available = (api: TurnstileApi | undefined): api is TurnstileApi => Boolean(api && typeof api.render === "function" && typeof api.reset === "function" && typeof api.remove === "function");

// 공식 스크립트를 직접 한 번만 로드한다. 실패한 로드는 지워 다음 명시적 재시도를 허용한다.
export function loadTurnstile(): Promise<TurnstileApi> {
  if (loading) return loading;
  if (available(window.turnstile)) return Promise.resolve(window.turnstile);
  const request = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT; script.async = true; script.defer = true;
    script.dataset.publicJoinChallenge = "true";
    let settled = false;
    const cleanup = () => { clearTimeout(timeout); script.removeEventListener("load", loaded); script.removeEventListener("error", failed); };
    const failed = () => { if (settled) return; settled = true; cleanup(); script.remove(); reject(new Error("turnstile_script_unavailable")); };
    const ready = () => {
      if (settled) return;
      if (!available(window.turnstile)) return failed();
      settled = true; cleanup(); resolve(window.turnstile);
    };
    const loaded = () => { try { if (!available(window.turnstile)) return failed(); if (window.turnstile.ready) window.turnstile.ready(ready); else ready(); } catch { failed(); } };
    const timeout = setTimeout(failed, 15_000);
    script.addEventListener("load", loaded); script.addEventListener("error", failed);
    document.head.append(script);
  });
  loading = request;
  void request.then(() => { if (loading === request) loading = null; }, () => { if (loading === request) loading = null; });
  return request;
}
