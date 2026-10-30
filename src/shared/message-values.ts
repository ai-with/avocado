import { withLangParam } from "./guide-public";
import { pickDeadline } from "./deadline";
import type { MessageLang } from "./message-render";
import type { ParticipationTerms } from "./participation";

// 인플루언서 한 명의 변수 값 사전 (TASK-073). 링크는 앱 절대 주소에 인플루언서 언어 ?lang=

export type ParticipantFacts = {
  influencerName: string;
  igHandle: string | null;
  brandName: string;
  campaignName: string;
  links: { guide: string; upload: string; feedback: string };
  guideDeadlineAt: number | null;
  contractStartAt: number | null;
  contractEndAt: number | null;
  terms: ParticipationTerms | null;
};
export type UserVariable = { key: string; defaultValue: string };

// 서버(Workers)는 UTC 라 날짜는 한국 시간 기준으로 쓴다
const TIME_ZONE = "Asia/Seoul";
const LOCALE: Record<MessageLang, string> = { ko: "ko-KR", en: "en-US" };

export function formatMessageDate(ms: number | null, lang: MessageLang): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(LOCALE[lang], { year: "numeric", month: "long", day: "numeric", timeZone: TIME_ZONE });
}

export function formatFee(terms: ParticipationTerms | null, lang: MessageLang): string {
  if (!terms || terms.amount === null) return "";
  const n = terms.amount.toLocaleString(LOCALE[lang]);
  return terms.currency === "KRW" && lang === "ko" ? `${n}원` : `${terms.currency} ${n}`;
}

export function systemValues(f: ParticipantFacts, lang: MessageLang): Record<string, string> {
  return {
    influencer_name: f.influencerName,
    ig_handle: f.igHandle ? `@${f.igHandle.replace(/^@/, "")}` : "",
    brand_name: f.brandName,
    campaign_name: f.campaignName,
    guide_link: withLangParam(f.links.guide, lang),
    upload_link: withLangParam(f.links.upload, lang),
    feedback_link: withLangParam(f.links.feedback, lang),
    deadline: formatMessageDate(pickDeadline(f.contractEndAt, f.guideDeadlineAt), lang),
    contract_start: formatMessageDate(f.contractStartAt, lang),
    contract_end: formatMessageDate(f.contractEndAt, lang),
    fee: formatFee(f.terms, lang),
    deliverables: f.terms?.deliverables ?? "",
  };
}

// 사용자 변수: 인플루언서별 값(terms.vars)이 있으면 그 값, 없으면 기본값
export function userValues(vars: UserVariable[], perInfluencer: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(vars.map((v) => [v.key, perInfluencer?.[v.key]?.trim() || v.defaultValue]));
}
