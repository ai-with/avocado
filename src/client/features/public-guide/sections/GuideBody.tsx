import type { ReactNode } from "react";
import type { Lang, TKey } from "../../../i18n";
import type { VideoGuide } from "../../../../shared/guides";
import { DEFAULT_CHANNELS } from "../../../../shared/leads";
import { defaultSceneKey } from "../../../../shared/guide-public";
import type { PersonalData, PublicGuide, T } from "../guideTypes";
import { PublicSection, TextList } from "./PublicShell";

type GuideProps = { g: PublicGuide; t: T };

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return <p><span className="text-caption">{label}</span><br />{children}</p>;
}

function ProductSection({ g, t }: GuideProps) {
  return (
    <PublicSection title={t("product")}>
      <p><strong>{g.product.name}</strong></p>
      {g.product.benefits.length > 0 && <TextList items={g.product.benefits} />}
      {g.product.usage && <Labeled label={t("usage")}>{g.product.usage}</Labeled>}
      {g.product.photos.length > 0 && <div className="pub-photos">{g.product.photos.map((p, i) => <img key={p} src={p} alt={`${g.product.name} ${i + 1}`} loading="lazy" />)}</div>}
      {g.purpose && <Labeled label={t("purpose")}>{g.purpose}</Labeled>}
      {g.lengthS && <Labeled label={t("length")}>{g.lengthS}{t("seconds")}</Labeled>}
    </PublicSection>
  );
}

// AI 초안의 기본 제목은 화면 언어로, 브랜드가 쓴 제목은 그대로
const sceneTitle = (s: VideoGuide["scenes"][number], t: T) => {
  const key = defaultSceneKey(s);
  return key ? t(`scene_${key}`) : s.title;
};

function ScenesSection({ vg, t, lang }: { vg: VideoGuide; t: T; lang: Lang }) {
  return (
    <PublicSection title={t("scenes")}>
      <ol className="pub-scenes">
        {vg.scenes.map((s) => {
          const [first, second] = lang === "en" ? [s.lineEn, s.lineKo] : [s.lineKo, s.lineEn];
          return (
            <li key={s.key}>
              <strong>{sceneTitle(s, t)}</strong>
              {s.description && <p>{s.description}</p>}
              {first && <p className="pub-line">"{first}"</p>}
              {second && <p className="text-caption">"{second}"</p>}
            </li>
          );
        })}
      </ol>
      {vg.tips.length > 0 && (<><h3 className="pub-sub">{t("tips")}</h3><TextList items={vg.tips} /></>)}
      {vg.references.length > 0 && (<><h3 className="pub-sub">{t("references")}</h3><ul className="pub-list">{vg.references.map((x) => <li key={x}><a href={x} target="_blank" rel="noreferrer">{x}</a></li>)}</ul></>)}
    </PublicSection>
  );
}

// 기본 채널은 화면 언어 사전으로, 브랜드가 추가한 채널은 브랜드가 지은 이름으로
const leadChannelName = (l: PersonalData["leadLinks"][number], t: T) =>
  DEFAULT_CHANNELS.some((c) => c.key === l.channel) ? t(`channel_${l.channel}` as TKey) : l.name;

const FORBIDDEN_TYPES = new Set(["forbidden_phrase", "forbidden_scene", "competitor_mention"]);
const isForbidden = (type: string) => FORBIDDEN_TYPES.has(type);
// 경쟁사 규칙은 이름만 있으면 뜻을 알 수 없어 유형 이름을 앞에 붙인다
const ruleText = (r: PublicGuide["rules"][number], t: T) => (r.type === "competitor_mention" ? `${t("rule_competitor")}: ${r.content}` : r.content);

function RulesSections({ g, t }: GuideProps) {
  const must = g.rules.filter((r) => !isForbidden(r.type)).map((r) => r.content);
  const forbidden = g.rules.filter((r) => isForbidden(r.type)).map((r) => ruleText(r, t));
  return (
    <>
      {must.length > 0 && <PublicSection title={t("rules_must")}><TextList items={must} /></PublicSection>}
      {forbidden.length > 0 && <PublicSection title={t("rules_forbidden")}><TextList items={forbidden} className="pub-forbidden" /></PublicSection>}
      {g.checklist.length > 0 && <PublicSection title={t("checklist")}><TextList items={g.checklist} /></PublicSection>}
    </>
  );
}

function ScheduleSections({ g, t, lang }: GuideProps & { lang: Lang }) {
  return (
    <>
      <PublicSection title={t("schedule")}>
        <p>{t("deadline")}: {g.deadlineAt ? new Date(g.deadlineAt).toLocaleDateString(lang === "en" ? "en-US" : "ko-KR") : t("no_deadline")}</p>
      </PublicSection>
      <PublicSection title={t("deliverables")}>
        <ul className="pub-list">
          <li>{t("final_cut")}</li>
          {g.deliverables.clean && <li>{t("clean_cut")}</li>}
          {g.deliverables.note && <li>{g.deliverables.note}</li>}
        </ul>
      </PublicSection>
    </>
  );
}

type BodyProps = { guide: PublicGuide; leadLinks?: PersonalData["leadLinks"]; t: T; lang: Lang };

// 인플루언서용 가이드 본문 (읽기 전용). 브랜드 편집 화면 미리보기도 같은 컴포넌트를 쓴다
export function GuideBody({ guide: g, leadLinks = [], t, lang }: BodyProps) {
  const vg = g.videoGuide;
  return (
    <>
      <h1 className="pub-title">{g.name}</h1>
      {vg?.purposeLine && <p className="text-secondary">{vg.purposeLine}</p>}
      <ProductSection g={g} t={t} />
      {vg && <ScenesSection vg={vg} t={t} lang={lang} />}
      <RulesSections g={g} t={t} />
      <ScheduleSections g={g} t={t} lang={lang} />
      {leadLinks.length > 0 && (
        <PublicSection title={t("my_links")}>
          <p className="text-caption">{t("my_links_hint")}</p>
          <ul className="pub-list">{leadLinks.map((l) => <li key={l.url} className="pub-link">{leadChannelName(l, t)}: <a href={l.url}>{l.url}</a></li>)}</ul>
        </PublicSection>
      )}
    </>
  );
}
