import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, FloatingActionBar, Input } from "../../../ui";
import { api, ApiError } from "../../../lib/api";
import { makeT, type Lang } from "../../../i18n";
import { PUBLIC_OPTS } from "../guideTypes";
import type { PublicJoinChallenge, PublicJoinRequest } from "../../../../shared/public-join";
import { withLangParam } from "../../../../shared/guide-public";
import { JoinChallenge } from "./JoinChallenge";

// 가이드 공용 링크(slug)로 들어온 사람이 이름을 남기고 개인 가이드 링크를 받는다
export function JoinForm({ slug, lang, title, challenge }: { slug: string; lang: Lang; title: string; challenge?: PublicJoinChallenge }) {
  const t = makeT(lang);
  const currentLang = useRef(lang); currentLang.current = lang;
  const navigate = useNavigate();
  const [f, setF] = useState({ displayName: "", igHandle: "", email: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [challengeVersion, setChallengeVersion] = useState(0);
  const [token, setToken] = useState<{ value: string | null; scope: string }>({ value: null, scope: "" });
  const actor = `${slug}:${challenge?.siteKey ?? ""}:${challenge?.cData ?? ""}`;
  const current = useRef(actor); current.current = actor;
  const mounted = useRef(false), sending = useRef(false), request = useRef(0);
  const onToken = useCallback((value: string | null) => setToken({ value, scope: actor }), [actor]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
  useEffect(() => { request.current++; sending.current = false; setBusy(false); setErr({}); }, [actor]);
  useEffect(() => { setF({ displayName: "", igHandle: "", email: "" }); }, [slug]);
  const configured = Boolean(challenge?.siteKey);
  const ready = configured && token.scope === actor && Boolean(token.value);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending.current) return;
    if (!configured || !ready) { setErr({ _: t(configured ? "join_verification_required" : "join_unavailable") }); return; }
    const ticket = ++request.current, scope = actor;
    const isCurrent = () => mounted.current && current.current === scope && request.current === ticket;
    const verificationToken = token.value!;
    sending.current = true; setBusy(true); setErr({}); onToken(null);
    try {
      const body: PublicJoinRequest = { ...f, lang, turnstileToken: verificationToken };
      const r = await api.post<{ guideToken: string }>(`/public/guide/${encodeURIComponent(slug)}/join`, body, PUBLIC_OPTS);
      if (isCurrent()) navigate(withLangParam(`/g/${encodeURIComponent(r.guideToken)}`, currentLang.current), { replace: true });
    } catch (e2) {
      if (!isCurrent()) return;
      const responseT = makeT(currentLang.current);
      const code = e2 instanceof ApiError ? e2.code : "unknown";
      const message = code === "join_rate_limited" ? "join_rate_limited" : code === "join_unavailable" ? "join_unavailable"
        : code === "turnstile_required" ? "join_verification_required" : code === "turnstile_failed" ? "join_verification_failed"
        : code === "turnstile_unavailable" ? "join_verification_failed" : ["validation_error", "request_too_large", "invalid_json"].includes(code) ? "join_invalid"
          : code === "link_not_found" ? "link_expired" : "join_failed";
      const fields = e2 instanceof ApiError ? Object.fromEntries(Object.entries(e2.fields).filter(([key]) => ["displayName", "email", "igHandle"].includes(key)).map(([key, value]) => [key, currentLang.current === "en" ? responseT("join_invalid_field") : value])) : {};
      setErr({ ...fields, _: responseT(message) });
      onToken(null); setChallengeVersion((value) => value + 1);
    } finally {
      if (isCurrent()) { sending.current = false; setBusy(false); }
    }
  };
  return (
    <>
    <form id="join-form" className="stack" onSubmit={submit}>
      <h1 className="pub-title">{title}</h1>
      <h2 className="pub-h">{t("shared_title")}</h2>
      <p className="text-secondary">{t("shared_desc")}</p>
      <Input label={t("name")} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} error={err.displayName} required />
      <Input label={t("ig_handle")} value={f.igHandle} onChange={(e) => setF({ ...f, igHandle: e.target.value })} placeholder="@handle" />
      <Input label={t("email")} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={err.email} />
      {challenge?.siteKey ? <JoinChallenge key={`${actor}:${challengeVersion}`} challenge={challenge} lang={lang} scope={actor} t={t} onToken={onToken} /> : <p className="text-secondary" role="status">{t("join_unavailable")}</p>}
      {err._ && <p className="field-error" role="alert">{err._}</p>}
    </form>
    <FloatingActionBar><Button type="submit" size="xl" form="join-form" loading={busy} disabled={!ready || busy}>{t("start")}</Button></FloatingActionBar>
    </>
  );
}
