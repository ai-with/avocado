import { DEFAULT_FORM_FIELDS, type AfterSubmit, type FormFields } from "../../../shared/leads";

export type Draft = {
  title: string;
  description: string;
  headerImageKey: string | null;
  guideId: string | null;
  fields: FormFields;
  closesAt: number | null;
  maxSubmissions: number | null;
  closedMessage: string;
  afterSubmit: AfterSubmit;
};
export const EMPTY: Draft = {
  title: "",
  description: "",
  headerImageKey: null,
  guideId: null,
  fields: DEFAULT_FORM_FIELDS,
  closesAt: null,
  maxSubmissions: null,
  closedMessage: "신청이 마감됐어요. 관심 가져 주셔서 고마워요.",
  afterSubmit: { type: "message", text: "신청이 접수됐어요. 곧 연락드릴게요.", documentId: null },
};
export type Submission = { id: string; at: number; answers: Record<string, string | string[]>; leadId: string | null; email: string | null; name: string | null };
export type Named = { id: string; name: string };
export type SetDraft = (patch: Partial<Draft>) => void;
