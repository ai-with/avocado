import { z } from "zod";
import { newId } from "../../lib/ids";
import { RULE_TARGETS, RULE_TYPES, type GuideRule } from "../../../shared/guides";

export const ruleBody = z.object({
  type: z.enum(RULE_TYPES),
  content: z.string().trim().min(1, "내용을 입력해 주세요.").max(300),
  severity: z.enum(["must", "should"]),
  targets: z.array(z.enum(RULE_TARGETS)).min(1, "검사 대상을 하나 이상 골라 주세요."),
  enabled: z.boolean().default(true),
});
const extraRule = ruleBody.extend({ id: z.string().optional() });

const sceneSchema = z.object({
  key: z.enum(["hook", "usage", "result", "closing"]),
  title: z.string().max(60),
  description: z.string().max(1000),
  lineEn: z.string().max(500),
  lineKo: z.string().max(500),
});
const videoGuideSchema = z.object({
  purposeLine: z.string().max(300),
  scenes: z.array(sceneSchema).max(8),
  tips: z.array(z.string().max(300)).max(20),
  checklist: z.array(z.string().max(400)).max(50),
  references: z.array(z.string().max(500)).max(10),
  deliverables: z.string().max(500),
  draft: z.boolean(),
});

// 기본값은 만들 때만 채운다. PATCH 에 default 가 섞이면 보내지 않은 필드가 덮어써진다
const guideFields = z.object({
  name: z.string().trim().min(1, "가이드 이름을 입력해 주세요.").max(80),
  guidelineSetId: z.string().nullable(),
  extraRules: z.array(extraRule).max(50),
  product: z.object({
    name: z.string().trim().max(80).default(""),
    benefits: z.array(z.string().trim().max(120)).max(5).default([]),
    usage: z.string().trim().max(1000).default(""),
    photos: z.array(z.string().trim().max(500)).max(10).default([]),
  }),
  purpose: z.string().trim().max(300),
  lengthS: z.number().int().min(5).max(180).nullable(),
  lang: z.enum(["ko", "en"]),
  deadlineAt: z.number().int().nullable(),
  deliverables: z.object({ final: z.boolean(), clean: z.boolean(), note: z.string().max(300) }),
  secondaryUseScope: z.object({ ads: z.boolean(), media: z.array(z.string().max(60)).max(20), regions: z.array(z.string().max(60)).max(20), months: z.number().int().min(0).max(120) }),
  videoGuide: videoGuideSchema.nullable(),
  // TASK-079: 이번 캠페인에서 끈 사전 규칙 id
  brandTermExclusions: z.array(z.string().regex(/^(bt|legal):/).max(80)).max(500),
});
export const guideCreate = guideFields.partial().required({ name: true });
export const guidePatch = guideFields.partial();
export const GUIDE_DEFAULTS: Omit<z.infer<typeof guideFields>, "name"> = {
  guidelineSetId: null,
  extraRules: [],
  product: { name: "", benefits: [], usage: "", photos: [] },
  purpose: "",
  lengthS: null,
  lang: "ko",
  deadlineAt: null,
  deliverables: { final: true, clean: false, note: "" },
  secondaryUseScope: { ads: false, media: [], regions: [], months: 0 },
  videoGuide: null,
  brandTermExclusions: [],
};

export const withRuleIds = (rules: z.infer<typeof extraRule>[]): GuideRule[] => rules.map((r) => ({ ...r, id: r.id?.startsWith("rule_") ? r.id : `rule_${newId()}` }));

export const influencerBody = z.object({
  displayName: z.string().trim().min(1, "이름을 입력해 주세요.").max(60),
  igHandle: z.string().trim().max(60).nullable().default(null),
  threadsHandle: z.string().trim().max(60).nullable().default(null),
  email: z.union([z.literal(""), z.email("이메일 형식이 아니에요.")]).nullable().default(null),
  lang: z.enum(["ko", "en"]).default("ko"),
  country: z.string().trim().toUpperCase().max(2).nullable().default(null),
});
type InfluencerInput = z.infer<typeof influencerBody>;
const cleanHandle = (h: string | null) => (h ? h.replace(/^@/, "") || null : null);
export const influencerValues = (b: InfluencerInput) => ({
  displayName: b.displayName,
  igHandle: cleanHandle(b.igHandle),
  threadsHandle: cleanHandle(b.threadsHandle),
  email: b.email || null,
  lang: b.lang,
  country: b.country || null,
});
