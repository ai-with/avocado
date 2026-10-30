import type { TKey } from "../../i18n";
import type { VersionGroup, VersionState } from "../../../shared/versions";
import type { T } from "./guideTypes";

const STATE_KEYS: Record<VersionState, TKey> = {
  uploading: "ver_uploading",
  reviewing: "ver_reviewing",
  feedback: "ver_feedback",
  approved: "ver_approved",
  kept_previous: "ver_kept_previous",
};

export const versionStateLabel = (t: T, state: VersionState) => t(STATE_KEYS[state]);

// 버전 한 줄: v2 · 완성본 · 클린본 있음 · 확인 중 (TASK-074)
export function versionLine(t: T, g: VersionGroup): string {
  const parts = [`v${g.version}`, g.hasFinal ? t("final_cut") : t("kind_clean"), g.hasFinal && g.hasClean ? t("clean_attached") : "", versionStateLabel(t, g.state)];
  return parts.filter(Boolean).join(" · ");
}
