import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Button, ButtonLink, FloatingActionBar, LoadingState } from "../../ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import { langFromSearch, withLangParam } from "../../../shared/guide-public";
import { PublicShell, PublicSection, TextList } from "../public-guide/sections/PublicShell";
import { CONNECT_TEXT, type ConnectText, type Lang } from "./connectText";
import { beginInstagramOAuth } from "./instagramOAuth";

type Info = { target: "influencer" | "client_brand"; name: string; lang: Lang; agencyName: string | null; brandName: string; configured: boolean; connected: boolean; expired: boolean; disconnected: boolean; reason: string | null; username: string | null; returnMode: "guide" | "connect"; returnUrl: string };

// 연결할 수 있을 때만 '연결' 버튼이 하단에 뜬다. 나머지 상태는 본문 글로 알린다
function ConnectCta({ info, token, t, lang }: { info: Info; token: string; t: ConnectText; lang: Lang }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { await beginInstagramOAuth({ target: info.target, token, returnMode: info.returnMode, lang }, true); }
    catch (e) { setError(e instanceof ApiError ? t.errors[e.code as keyof typeof t.errors] ?? t.errors.other : t.errors.other); }
    finally { setBusy(false); }
  };
  if (info.connected && info.username) return <p className="pub-ok">{t.connectedAs(info.username)}</p>;
  if (!info.configured) return <p className="text-secondary">{t.preparing}</p>;
  return (
    <FloatingActionBar>
      {error && <p className="pub-error" role="alert">{error}</p>}
      <Button size="xl" loading={busy} onClick={() => void start()}>{info.expired || info.disconnected ? t.reconnect : t.connect}</Button>
    </FloatingActionBar>
  );
}

function ConnectBody({ info, token, t, lang }: { info: Info; token: string; t: ConnectText; lang: Lang }) {
  const [sp] = useSearchParams();
  const err = sp.get("error");
  const done = (sp.get("done") === "1" || sp.get("ig") === "connected") && info.connected;
  const returnGuide = info.returnMode === "guide" && /^\/g\/[A-Za-z0-9_-]+(?:\?|$)/.test(info.returnUrl) ? withLangParam(info.returnUrl, lang) : null;
  return (
    <>
      <h1 className="pub-title">{t.title}</h1>
      <p>{t.lead(info.brandName)}</p>
      {info.agencyName && <p><strong>{t.agency(info.agencyName)}</strong></p>}
      <p className="pub-ok">{t.optional}</p>
      {done && <p className="pub-ok" role="status">{t.done}</p>}
      {sp.get("ig") === "cancelled" && <p className="text-secondary" role="status">{t.errors.denied}</p>}
      {err && <p className="pub-error" role="alert">{t.errors[err as keyof typeof t.errors] ?? t.errors.other}</p>}
      {!info.connected && (info.expired || info.disconnected) && <p className="pub-error">{t.disconnected}</p>}
      {!info.connected && ["grant_unverified", "permissions_missing", "not_professional"].includes(info.reason ?? "") && <p className="text-secondary">{t.verify}</p>}
      <PublicSection title={t.takes}>
        <TextList items={t.takesList} />
        <h2 className="pub-h">{t.notTakes}</h2>
        <TextList items={t.notTakesList} />
        <h2 className="pub-h">{t.period}</h2>
        <p>{t.periodText}</p>
        <p className="text-caption">{t.pro}</p>
      </PublicSection>
      {returnGuide && <ButtonLink variant="secondary" to={returnGuide}>{t.returnGuide}</ButtonLink>}
      <ConnectCta info={info} token={token} t={t} lang={lang} />
    </>
  );
}

// /connect/:token (F-54). 인플루언서 또는 고객사 담당자가 본인 로그인으로 직접 연결한다
export function ConnectPublicPage() {
  const { token = "" } = useParams();
  const [sp] = useSearchParams();
  const requestedLang = langFromSearch(`?${sp.toString()}`);
  const returnMode = sp.get("returnMode") === "guide" ? "guide" : "connect";
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [lang, setLang] = useState<Lang>(requestedLang ?? "ko");
  useEffect(() => {
    setInfo(null); setError("");
    if (requestedLang) setLang(requestedLang);
    api
      .get<Info>(`/ig/connect/${encodeURIComponent(token)}?returnMode=${returnMode}${requestedLang ? `&lang=${requestedLang}` : ""}`, { redirectOn401: false })
      .then((d) => {
        setInfo(d);
        setLang(d.lang);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [token, returnMode, requestedLang]);
  const t = CONNECT_TEXT[lang];

  return (
    <PublicShell brand={info?.brandName} langLabel={t.toggle} onToggleLang={() => setLang(lang === "ko" ? "en" : "ko")}>
      {error ? <p className="pub-error">{t.notFound}</p> : !info ? <LoadingState pattern="detail" /> : <ConnectBody info={info} token={token} t={t} lang={lang} />}
    </PublicShell>
  );
}
