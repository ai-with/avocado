import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, FloatingActionBar, Input } from "../../../ui";
import { api, ApiError, errorMessage } from "../../../lib/api";
import { makeT, type Lang } from "../../../i18n";
import { PUBLIC_OPTS } from "../guideTypes";

// 가이드 공용 링크(slug)로 들어온 사람이 이름을 남기고 개인 가이드 링크를 받는다
export function JoinForm({ slug, lang, title }: { slug: string; lang: Lang; title: string }) {
  const t = makeT(lang);
  const navigate = useNavigate();
  const [f, setF] = useState({ displayName: "", igHandle: "", email: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.post<{ guideToken: string }>(`/public/guide/${slug}/join`, { ...f, lang }, PUBLIC_OPTS);
      navigate(`/g/${r.guideToken}`, { replace: true });
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.fields : { _: errorMessage(e2) });
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
      {err._ && <p className="field-error" role="alert">{err._}</p>}
    </form>
    <FloatingActionBar><Button type="submit" size="xl" form="join-form">{t("start")}</Button></FloatingActionBar>
    </>
  );
}
