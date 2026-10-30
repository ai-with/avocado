import { Badge, ButtonLink, EmptyState, FloatingActionBar, type BadgeTone } from "../../../ui";
import type { Lang } from "../../../i18n";
import type { InfluencerTabs } from "../../../../shared/influencer-tabs";
import type { VersionGroup, VersionState } from "../../../../shared/versions";
import { formatDeadlineDate } from "../../../../shared/deadline";
import { withLangParam } from "../../../../shared/guide-public";
import type { T } from "../../public-guide/guideTypes";
import { versionStateLabel } from "../../public-guide/versionLabel";
import { FeedbackCard, PostUrl, type FeedbackCtx, type PublicFeedbackItem } from "./FeedbackCard";

type Round = { n: number; submittedAt: number; items: PublicFeedbackItem[] };
type VersionHistory = VersionGroup & { rounds: Round[] };
export type FeedbackData = {
  brandName: string;
  guideName: string;
  lang: Lang;
  displayName: string;
  tabs: InfluencerTabs;
  approved: boolean;
  approvedVersion: number | null;
  postUrl: string | null;
  versions: VersionHistory[];
};

const STATE_TONES: Record<VersionState, BadgeTone> = { uploading: "info", reviewing: "neutral", feedback: "warn", approved: "success", kept_previous: "neutral" };
const WAITING: VersionState[] = ["uploading", "reviewing"];

// 피드백 탭 = 업로드한 버전별 피드백 이력, 최신 버전 먼저 (TASK-074)
export function FeedbackPublicBody({ data, base, t, lang, onChanged }: FeedbackCtx & { data: FeedbackData; lang: Lang }) {
  const uploadTo = data.tabs.upload ? withLangParam(data.tabs.upload, lang) : null;
  const canUploadNew = !data.approved && !!uploadTo && data.versions.some((v) => v.rounds.length > 0);
  return (
    <>
      <h1 className="pub-title">{t("fb_title")}</h1>
      <p className="text-secondary">{data.guideName}</p>
      {data.approved && <PostUrl base={base} t={t} initial={data.postUrl} />}
      {data.versions.length === 0 && <EmptyState title={t("fb_history_empty")} action={uploadTo && <ButtonLink variant="primary" to={uploadTo}>{t("fb_go_upload")}</ButtonLink>} />}
      {data.versions.map((v, i) => <VersionCard key={v.version} v={v} latest={i === 0} base={base} t={t} onChanged={onChanged} />)}
      {canUploadNew && <FloatingActionBar><ButtonLink variant="primary" size="xl" to={uploadTo!}>{t("fb_upload_new")}</ButtonLink></FloatingActionBar>}
    </>
  );
}

function VersionCard({ v, latest, base, t, onChanged }: FeedbackCtx & { v: VersionHistory; latest: boolean }) {
  const kinds = [v.hasFinal ? t("final_cut") : t("kind_clean"), v.hasFinal && v.hasClean ? t("clean_attached") : ""].filter(Boolean).join(" · ");
  return (
    <section className="pub-section pub-version">
      <div className="pub-version-head">
        <h2 className="pub-h">v{v.version}</h2>
        <Badge tone={STATE_TONES[v.state]}>{versionStateLabel(t, v.state)}</Badge>
      </div>
      <p className="text-caption">{[kinds, v.uploadedAt ? t("fb_uploaded_on").replace("{date}", formatDeadlineDate(v.uploadedAt)) : ""].filter(Boolean).join(" · ")}</p>
      {v.rounds.length === 0 && WAITING.includes(v.state) && <p className="text-secondary">{t("fb_waiting")}</p>}
      {v.rounds.map((r) => (
        <div key={r.n} className="stack">
          <h3 className="pub-sub">{t("fb_round").replace("{n}", String(r.n))}</h3>
          {r.items.map((it) => <FeedbackCard key={it.id} it={it} base={base} t={t} onChanged={onChanged} readOnly={!latest} />)}
        </div>
      ))}
    </section>
  );
}
