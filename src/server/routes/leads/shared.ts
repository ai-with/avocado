import { z } from "zod";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../../db";
import { guides, influencers, leadTags, leads, shortLinks } from "../../db/schema";
import { findLive } from "../../lib/owned";
import { assertSearchReady, leadPlan, queryLeadRows } from "../../lib/lead-query";
import { ensureChannels } from "../../lib/links";

// 리드 라우트 공용

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("이메일 형식이 아니에요."));

export async function filteredLeads(db: Db, workspaceId: string, q: Record<string, string>) {
  const plan = await leadPlan(db, workspaceId, q); await assertSearchReady(db, plan);
  return queryLeadRows(db, plan, true);
}

// 콘텐츠 링크 이름표. 지운 링크로 들어온 리드도 이름이 보이게 지운 것까지 포함
async function contentLookups(db: Db, workspaceId: string) {
  const rows = await db
    .select({ id: shortLinks.id, label: shortLinks.contentLabel, influencerName: influencers.displayName })
    .from(shortLinks)
    .leftJoin(influencers, and(eq(influencers.id, shortLinks.influencerId), eq(influencers.workspaceId, workspaceId)))
    .where(and(eq(shortLinks.workspaceId, workspaceId), isNotNull(shortLinks.contentKey)))
    .orderBy(asc(shortLinks.createdAt));
  return rows.map((r) => ({ id: r.id, label: r.label ?? "", name: `${r.label ?? ""} · ${r.influencerName ?? "가이드 공용"}` }));
}

export async function lookups(db: Db, workspaceId: string) {
  const [g, i, channels, tags, contents] = await Promise.all([
    db.select({ id: guides.id, name: guides.name }).from(guides).where(eq(guides.workspaceId, workspaceId)),
    db.select({ id: influencers.id, name: influencers.displayName }).from(influencers).where(eq(influencers.workspaceId, workspaceId)),
    ensureChannels(db, workspaceId),
    db.select().from(leadTags).where(eq(leadTags.workspaceId, workspaceId)).orderBy(asc(leadTags.name)),
    contentLookups(db, workspaceId),
  ]);
  return { guides: g, influencers: i, channels: channels.map((ch) => ({ key: ch.key, name: ch.name })), tags, contents };
}

export const ownLead = (db: Db, workspaceId: string, id: string) => findLive(db, leads, id, workspaceId, { code: "lead_not_found", message: "리드를 찾을 수 없어요." });

export const publicLead = (l: typeof leads.$inferSelect) => {
  const { unsubscribeToken: _t, workspaceId: _w, deletedAt: _d, searchEmailV1: _se, searchNameV1: _sn, searchCompanyV1: _sc, searchPhoneV1: _sp, ...rest } = l;
  return rest;
};
