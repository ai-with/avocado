import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { guideInfluencers, guides, influencers, messageTemplateBodies, messageTemplates, messageVariables } from "../db/schema";
import { findOwned } from "./owned";
import { now } from "./ids";
import { brandNameOf, campaignOf } from "./brands";
import { guideLinks } from "./guides";
import { contractOf } from "./participation";
import { MESSAGE_LANGS, templatesUsing, type MessageLang } from "../../shared/message-render";
import { systemValues, userValues } from "../../shared/message-values";

// 메시지 변수·템플릿 공용 (TASK-073). 라우트는 routes/messages, routes/guides/messages

export type TemplateBodies = Partial<Record<MessageLang, string>>;

export const findVariable = (db: Db, workspaceId: string, id: string) =>
  findOwned(db, messageVariables, id, workspaceId, { code: "variable_not_found", message: "변수를 찾을 수 없어요." });

export const findTemplate = (db: Db, workspaceId: string, id: string) =>
  findOwned(db, messageTemplates, id, workspaceId, { code: "template_not_found", message: "템플릿을 찾을 수 없어요." });

export const userVariablesOf = (db: Db, workspaceId: string) =>
  db.select().from(messageVariables).where(eq(messageVariables.workspaceId, workspaceId)).orderBy(asc(messageVariables.createdAt));

// 템플릿 목록 + 언어별 본문
export async function templatesOf(db: Db, workspaceId: string) {
  const list = await db.select().from(messageTemplates).where(eq(messageTemplates.workspaceId, workspaceId)).orderBy(asc(messageTemplates.createdAt));
  const ids = list.map((t) => t.id);
  const bodies = ids.length ? await db.select().from(messageTemplateBodies).where(inArray(messageTemplateBodies.templateId, ids)) : [];
  return list.map((t) => ({
    ...t,
    bodies: Object.fromEntries(bodies.filter((b) => b.templateId === t.id).map((b) => [b.lang, b.body])) as TemplateBodies,
  }));
}

// 변수를 쓰는 템플릿 이름 (삭제 전 경고)
export async function variableUsage(db: Db, workspaceId: string, key: string): Promise<string[]> {
  const list = await templatesOf(db, workspaceId);
  return templatesUsing(list.map((t) => ({ name: t.name, bodies: Object.values(t.bodies) })), key);
}

// 본문 저장: 빈 언어는 지우고 나머지는 덮어쓴다
export async function saveBodies(db: Db, templateId: string, bodies: TemplateBodies) {
  const at = now();
  for (const lang of MESSAGE_LANGS) {
    const body = bodies[lang]?.trim() ? bodies[lang]! : "";
    if (!body) {
      await db.delete(messageTemplateBodies).where(and(eq(messageTemplateBodies.templateId, templateId), eq(messageTemplateBodies.lang, lang)));
      continue;
    }
    await db
      .insert(messageTemplateBodies)
      .values({ templateId, lang, body, updatedAt: at })
      .onConflictDoUpdate({ target: [messageTemplateBodies.templateId, messageTemplateBodies.lang], set: { body, updatedAt: at } });
  }
}

type GuideRow = typeof guides.$inferSelect;
type GiRow = typeof guideInfluencers.$inferSelect;

// 인플루언서 한 명의 언어별 값 사전(기본 변수 + 사용자 변수)
export async function participantValues(env: Env, db: Db, g: GuideRow, gi: GiRow) {
  const inf = await db.select().from(influencers).where(eq(influencers.id, gi.influencerId)).get();
  const [brandName, campaign, vars] = await Promise.all([brandNameOf(db, g.workspaceId, g.id), campaignOf(db, g.campaignId), userVariablesOf(db, g.workspaceId)]);
  const facts = {
    influencerName: inf?.displayName ?? "",
    igHandle: inf?.igHandle ?? null,
    brandName,
    campaignName: campaign?.name ?? g.name,
    links: guideLinks(env, gi),
    guideDeadlineAt: g.deadlineAt,
    ...contractOf(gi),
    terms: gi.terms,
  };
  const users = userValues(vars, gi.terms?.vars);
  const values = Object.fromEntries(MESSAGE_LANGS.map((lang) => [lang, { ...users, ...systemValues(facts, lang) }])) as Record<MessageLang, Record<string, string>>;
  return { values, lang: inf?.lang ?? "ko", email: inf?.email ?? null, brandName };
}
