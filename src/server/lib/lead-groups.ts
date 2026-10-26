import type { GroupCondition, GroupRules, LeadSourceType } from "../../shared/leads";

// 그룹 규칙 평가에 필요한 리드 사실. 목록 API 가 리드·출처·태그를 모아 만든다
export type LeadFacts = {
  marketingOptIn: boolean;
  alimtalkOptIn: boolean;
  createdAt: number;
  tagIds: string[];
  sources: { type: LeadSourceType; guideId: string | null; influencerId: string | null; channelKey: string | null; linkId?: string | null }[];
};

function matches(c: GroupCondition, lead: LeadFacts): boolean {
  switch (c.field) {
    case "marketing_opt_in":
      return lead.marketingOptIn === toBool(c.value);
    case "alimtalk_opt_in":
      return lead.alimtalkOptIn === toBool(c.value);
    case "created_after":
      return lead.createdAt >= Number(c.value);
    case "tag_id":
      return lead.tagIds.includes(String(c.value));
    case "guide_id":
      return lead.sources.some((s) => s.guideId === c.value);
    case "influencer_id":
      return lead.sources.some((s) => s.influencerId === c.value);
    case "channel_key":
      return lead.sources.some((s) => s.channelKey === c.value);
    case "source_type":
      return lead.sources.some((s) => s.type === c.value);
  }
}

const toBool = (v: string | number | boolean) => v === true || v === "true" || v === 1;

// 모든 조건(all)을 만족하면 그룹에 든다. 조건이 없으면 전원. neq 는 "해당하는 출처가 하나도 없음"
export function evaluateGroup(rules: GroupRules, lead: LeadFacts): boolean {
  return rules.all.every((c) => (c.op === "neq" ? !matches(c, lead) : matches(c, lead)));
}
