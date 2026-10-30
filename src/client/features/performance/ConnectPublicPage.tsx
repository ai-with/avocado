import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Button, FloatingActionBar, LoadingState } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { PublicShell, PublicSection, TextList } from "../public-guide/sections/PublicShell";
import { CONNECT_TEXT, type ConnectText, type Lang } from "./connectText";

type Info = { target: "influencer" | "client_brand"; name: string; lang: Lang; agencyName: string | null; brandName: string; configured: boolean; connected: boolean; username: string | null };

// 연결할 수 있을 때만 '연결' 버튼이 하단에 뜬다. 나머지 상태는 본문 글로 알린다
function ConnectCta({ info, token, t }: { info: Info; token: string; t: ConnectText }) {
  if (info.connected && info.username) return <p className="pub-ok">{t.connectedAs(info.username)}</p>;
  if (!info.configured) return <p className="text-secondary">{t.preparing}</p>;
  return (
    <FloatingActionBar>
      <Button size="xl" onClick={() => location.assign(`/api/ig/oauth/start?target=${info.target}&token=${encodeURIComponent(token)}`)}>{t.connect}</Button>
    </FloatingActionBar>
  );
}

function ConnectBody({ info, token, t }: { info: Info; token: string; t: ConnectText }) {
  const [sp] = useSearchParams();
  const err = sp.get("error");
  const done = sp.get("done") === "1";
  return (
    <>
      <h1 className="pub-title">{t.title}</h1>
      <p>{t.lead(info.brandName)}</p>
      {info.agencyName && <p><strong>{t.agency(info.agencyName)}</strong></p>}
      <p className="pub-ok">{t.optional}</p>
      {done && <p className="pub-ok" role="status">{t.done}</p>}
      {err && <p className="pub-error" role="alert">{t.errors[err as keyof typeof t.errors] ?? t.errors.other}</p>}
      <PublicSection title={t.takes}>
        <TextList items={t.takesList} />
        <h2 className="pub-h">{t.notTakes}</h2>
        <TextList items={t.notTakesList} />
        <h2 className="pub-h">{t.period}</h2>
        <p>{t.periodText}</p>
        <p className="text-caption">{t.pro}</p>
      </PublicSection>
      <ConnectCta info={info} token={token} t={t} />
    </>
  );
}

// /connect/:token (F-54). 인플루언서 또는 고객사 담당자가 본인 로그인으로 직접 연결한다
export function ConnectPublicPage() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [lang, setLang] = useState<Lang>("ko");
  useEffect(() => {
    api
      .get<Info>(`/ig/connect/${token}`, { redirectOn401: false })
      .then((d) => {
        setInfo(d);
        setLang(d.lang);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [token]);
  const t = CONNECT_TEXT[lang];

  return (
    <PublicShell brand={info?.brandName} langLabel={t.toggle} onToggleLang={() => setLang(lang === "ko" ? "en" : "ko")}>
      {error ? <p className="pub-error">{t.notFound}</p> : !info ? <LoadingState /> : <ConnectBody info={info} token={token} t={t} />}
    </PublicShell>
  );
}
