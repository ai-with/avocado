import type { Lang, TKey } from "../../i18n";
import type { GuideProduct, RuleSeverity, RuleType, SecondaryUseScope, VideoGuide } from "../../../shared/guides";

export type PublicGuide = {
  brandName: string;
  name: string;
  product: GuideProduct;
  purpose: string;
  lengthS: number | null;
  deadlineAt: number | null;
  deliverables: { final: boolean; clean: boolean; note: string };
  secondaryUseScope: SecondaryUseScope;
  videoGuide: VideoGuide | null;
  rules: { type: RuleType; content: string; severity: RuleSeverity }[];
  checklist: string[];
};
export type PersonalData = {
  mode: "personal";
  lang: Lang;
  influencer: { displayName: string; email: string | null; country: string | null };
  guide: PublicGuide;
  consent: { agreedAt: number; docVersion: string } | null;
  uploadUrl: string | null;
  leadLinks: { channel: string; name: string; url: string }[];
};
export type GuideData = { mode: "shared"; lang: Lang; guide: PublicGuide } | PersonalData;
export type T = (k: TKey) => string;

// 공개 화면은 로그인이 없으므로 401 이어도 로그인 화면으로 보내지 않는다
export const PUBLIC_OPTS = { redirectOn401: false };
