import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../db";
import { guides, influencers, leadGroups, leadTags, leads } from "../../db/schema";
import { findLive } from "../../lib/owned";
import { loadLeads } from "../../lib/leads";
import { evaluateGroup } from "../../lib/lead-groups";
import { ensureChannels } from "../../lib/links";
import type { GroupCondition, GroupRules } from "../../../shared/leads";

// 리드 라우트 공용

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("이메일 형식이 아니에요."));

// 목록 필터 쿼리 → 그룹 규칙 필드
const FILTER_FIELDS: [string, GroupCondition["field"]][] = [
  ["sourceType", "source_type"],
  ["guideId", "guide_id"],
  ["influencerId", "influencer_id"],
  ["channelKey", "channel_key"],
  ["tagId", "tag_id"],
  ["marketing", "marketing_opt_in"],
  ["alimtalk", "alimtalk_opt_in"],
];

// 목록 필터를 그룹 규칙으로 바꿔 같은 평가 함수를 쓴다
function filterRules(q: Record<string, string>): GroupCondition[] {
  const all: GroupCondition[] = [];
  for (const [param, field] of FILTER_FIELDS) if (q[param]) all.push({ field, op: "eq", value: q[param] });
  return all;
}

export async function filteredLeads(db: Db, workspaceId: string, q: Record<string, string>) {
  const all = await loadLeads(db, workspaceId);
  const rules: GroupRules = { all: filterRules(q) };
  if (q.groupId) {
    const g = await db.select().from(leadGroups).where(and(eq(leadGroups.id, q.groupId), eq(leadGroups.workspaceId, workspaceId))).get();
    if (g) rules.all.push(...g.rules.all);
  }
  const text = (q.q ?? "").trim().toLowerCase();
  return all.filter(
    ({ lead, facts }) =>
      evaluateGroup(rules, facts) && (!text || [lead.email, lead.name, lead.company, lead.phone].some((v) => v?.toLowerCase().includes(text))),
  );
}

export async function lookups(db: Db, workspaceId: string) {
  const [g, i, channels, tags] = await Promise.all([
    db.select({ id: guides.id, name: guides.name }).from(guides).where(eq(guides.workspaceId, workspaceId)),
    db.select({ id: influencers.id, name: influencers.displayName }).from(influencers).where(eq(influencers.workspaceId, workspaceId)),
    ensureChannels(db, workspaceId),
    db.select().from(leadTags).where(eq(leadTags.workspaceId, workspaceId)).orderBy(asc(leadTags.name)),
  ]);
  return { guides: g, influencers: i, channels: channels.map((ch) => ({ key: ch.key, name: ch.name })), tags };
}

export const ownLead = (db: Db, workspaceId: string, id: string) => findLive(db, leads, id, workspaceId, { code: "lead_not_found", message: "리드를 찾을 수 없어요." });

export const publicLead = (l: typeof leads.$inferSelect) => {
  const { unsubscribeToken: _t, workspaceId: _w, deletedAt: _d, ...rest } = l;
  return rest;
};
