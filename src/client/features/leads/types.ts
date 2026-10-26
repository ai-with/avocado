import type { LeadSourceType } from "../../../shared/leads";

export type Source = { type: LeadSourceType; guideId: string | null; influencerId: string | null; channelKey: string | null; linkId: string | null; at: number };
export type LeadRow = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  answers: Record<string, string | string[]>;
  marketingOptIn: boolean;
  alimtalkOptIn: boolean;
  unsubscribedAt: number | null;
  bouncedAt: number | null;
  firstSource: Source;
  lastSource: Source;
  createdAt: number;
  tagIds: string[];
  sourceTypes: LeadSourceType[];
};
export type Lookups = {
  guides: { id: string; name: string }[];
  influencers: { id: string; name: string }[];
  channels: { key: string; name: string }[];
  tags: { id: string; name: string }[];
  // 콘텐츠별 링크. label 은 콘텐츠 이름, name 은 "이름 · 인플루언서"
  contents: { id: string; label: string; name: string }[];
};
export type LeadDetail = {
  lead: Omit<LeadRow, "tagIds" | "sourceTypes">;
  tagIds: string[];
  sources: Source[];
  views: { id: string; title: string; pages: number; maxPage: number; completed: boolean; startedAt: number; pageDwell: { page: number; dwellMs: number }[] }[];
  submissions: { id: string; formTitle: string; answers: Record<string, string | string[]>; questions: { id: string; label: string }[]; at: number }[];
  messages: unknown[];
};

export const EMPTY_LOOKUPS: Lookups = { guides: [], influencers: [], channels: [], tags: [], contents: [] };
// 출처 링크가 콘텐츠 링크면 그 콘텐츠 이름, 아니면 빈 문자열
export const contentLabelOf = (lk: Lookups, linkId: string | null) => (linkId ? (lk.contents.find((c) => c.id === linkId)?.label ?? "") : "");
export const nameOf = (list: { id: string; name: string }[], id: string | null) => (id ? (list.find((x) => x.id === id)?.name ?? "") : "");
