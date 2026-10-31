import { useEffect, useRef, useState } from "react";
import { Button } from "../../../ui";
import type { PublicJoinChallenge } from "../../../../shared/public-join";
import type { Lang } from "../../../i18n";
import type { T } from "../guideTypes";
import { loadTurnstile, type TurnstileApi } from "../turnstile";

type Status = "loading" | "ready" | "expired" | "error";
export function JoinChallenge({ challenge, lang, scope, t, onToken }: { challenge: PublicJoinChallenge; lang: Lang; scope: string; t: T; onToken: (token: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);
  const current = useRef(scope); current.current = scope;
  useEffect(() => {
    let active = true;
    const isCurrent = () => active && current.current === scope;
    onToken(null); setStatus("loading");
    void loadTurnstile().then((api) => {
      if (!isCurrent() || !container.current || !challenge.siteKey) return;
      const clear = (state: Status) => { if (isCurrent()) { onToken(null); setStatus(state); } };
      const id = api.render(container.current, {
        sitekey: challenge.siteKey, action: challenge.action, cData: challenge.cData, language: lang, size: "flexible",
        retry: "never", "refresh-expired": "manual", "refresh-timeout": "manual", "response-field": false,
        callback: (token) => {
          if (!isCurrent()) return;
          if (typeof token !== "string" || !token.trim() || token.length > 2048) return clear("error");
          onToken(token); setStatus("ready");
        },
        "expired-callback": () => clear("expired"),
        "error-callback": () => { clear("error"); return true; },
        "timeout-callback": () => clear("expired"),
        "unsupported-callback": () => clear("error"),
      });
      if (!isCurrent()) { api.remove(id); return; }
      widget.current = { api, id };
    }).catch(() => { if (isCurrent()) { onToken(null); setStatus("error"); } });
    return () => { active = false; const previous = widget.current; widget.current = null; if (previous) { try { previous.api.remove(previous.id); } catch { /* 제거된 위젯의 늦은 콜백은 active로 막는다. */ } } };
  }, [challenge.siteKey, challenge.action, challenge.cData, lang, scope, onToken, attempt]);
  const retry = () => {
    onToken(null); setStatus("loading");
    if (!widget.current) { setAttempt((value) => value + 1); return; }
    try { widget.current.api.reset(widget.current.id); }
    catch { setAttempt((value) => value + 1); }
  };
  return <div className="stack-tight">
    <div ref={container} className="pub-turnstile" aria-label={t("join_verification_label")} />
    {status === "loading" && <p className="text-caption" role="status">{t("join_verification_loading")}</p>}
    {status === "ready" && <p className="text-caption" role="status">{t("join_verification_ready")}</p>}
    {(status === "error" || status === "expired") && <>
      <p className="field-error" role="alert">{t(status === "expired" ? "join_verification_expired" : "join_verification_failed")}</p>
      <Button variant="secondary" size="sm" onClick={retry}>{t("join_verification_retry")}</Button>
    </>}
  </div>;
}
