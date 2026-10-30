import { useState, type FormEvent } from "react";
import { Button, Card, FloatingActionBar, Checkbox, Input, SelectMenu } from "../../../ui";
import { api, ApiError, errorMessage } from "../../../lib/api";
import { makeT, type Lang, type TKey } from "../../../i18n";
import { CONSENT_ITEMS, CONSENT_NOTICES, EU_COUNTRIES, type SecondaryUseScope } from "../../../../shared/guides";
import { countryOptions } from "../../../lib/countries";
import { PUBLIC_OPTS, type PersonalData, type T } from "../guideTypes";

function ScopeList({ scope, t }: { scope: SecondaryUseScope; t: T }) {
  return (
    <dl className="pub-scope">
      <dt>{t("scope_ads")}</dt><dd>{scope.ads ? t("yes") : t("no")}</dd>
      <dt>{t("scope_media")}</dt><dd>{scope.media.join(", ") || "-"}</dd>
      <dt>{t("scope_regions")}</dt><dd>{scope.regions.join(", ") || "-"}</dd>
      <dt>{t("scope_months")}</dt><dd>{scope.months}</dd>
    </dl>
  );
}

type ItemsProps = { items: Record<string, boolean>; setItems: (v: Record<string, boolean>) => void; scope: SecondaryUseScope; t: T };

function ConsentItems({ items, setItems, scope, t }: ItemsProps) {
  return (
    <>
      {CONSENT_ITEMS.map((i) => (
        <Card key={i.key} className="pub-consent">
          <Checkbox
            checked={!!items[i.key]}
            onChange={(e) => setItems({ ...items, [i.key]: e.target.checked })}
            label={<><span className={`pub-tag ${i.required ? "is-req" : ""}`}>{i.required ? t("required") : t("optional")}</span> {t(`consent_${i.key}` as TKey)}</>}
          />
          {i.key === "secondary_use" && <ScopeList scope={scope} t={t} />}
        </Card>
      ))}
      {CONSENT_NOTICES.map((k) => (
        <Card key={k} className="pub-consent"><span className="pub-tag">{t("notice")}</span> {t(`consent_${k}` as TKey)}</Card>
      ))}
    </>
  );
}

function useConsentForm(token: string, data: PersonalData, t: T, onDone: () => void) {
  const [items, setItems] = useState<Record<string, boolean>>({});
  const [name, setName] = useState(data.influencer.displayName);
  const [email, setEmail] = useState(data.influencer.email ?? "");
  const [country, setCountry] = useState(data.influencer.country ?? "KR");
  const [age, setAge] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const allRequired = CONSENT_ITEMS.every((i) => !i.required || items[i.key]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!allRequired) return setMsg(t("consent_need_all"));
    try {
      await api.post(`/public/guide/${token}/consent`, { items, name, email, country, ageConfirmed: age }, PUBLIC_OPTS);
      onDone();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.fields : {});
      setMsg(errorMessage(e2));
    }
  };
  return { items, setItems, name, setName, email, setEmail, country, setCountry, age, setAge, err, msg, allRequired, submit };
}

const FORM_ID = "consent-form";

export function ConsentForm({ token, lang, data, onDone }: { token: string; lang: Lang; data: PersonalData; onDone: () => void }) {
  const t = makeT(lang);
  const s = useConsentForm(token, data, t, onDone);
  return (
    <>
    <form id={FORM_ID} className="stack" onSubmit={s.submit}>
      <h1 className="pub-title">{t("consent_title")}</h1>
      <p className="text-secondary">{t("consent_desc")}</p>
      <ConsentItems items={s.items} setItems={s.setItems} scope={data.guide.secondaryUseScope} t={t} />
      <Input label={t("name")} value={s.name} onChange={(e) => s.setName(e.target.value)} error={s.err.name} required />
      <Input label={t("email")} type="email" value={s.email} onChange={(e) => s.setEmail(e.target.value)} error={s.err.email} required />
      <SelectMenu label={t("country")} options={countryOptions(lang).map((c) => ({ value: c.code, label: c.label }))} value={s.country} onChange={(v) => v && s.setCountry(v)} />
      {EU_COUNTRIES.includes(s.country) && <Card className="pub-consent"><span className="pub-tag">{t("notice")}</span> {t("consent_eu")}</Card>}
      <Checkbox checked={s.age} onChange={(e) => s.setAge(e.target.checked)} label={t("age_confirm")} />
      {s.err.ageConfirmed && <p className="field-error">{s.err.ageConfirmed}</p>}
      {s.msg && <p className="field-error" role="alert">{s.msg}</p>}
    </form>
    <FloatingActionBar>
      <Button type="submit" size="xl" form={FORM_ID} disabled={!s.allRequired || !s.age}>{t("submit_consent")}</Button>
    </FloatingActionBar>
    </>
  );
}
