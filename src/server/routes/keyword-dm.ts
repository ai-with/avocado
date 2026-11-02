import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, gte, inArray, isNull, count, sql } from "drizzle-orm";
import type { AppEnv } from "../types";
import type { Db } from "../db";
import { guides, influencers, keywordDmRules, keywordDmSends, shortLinks } from "../db/schema";
import { ApiError, parse } from "../lib/errors";
import { newId, now } from "../lib/ids";
import { logEvent } from "../lib/events";
import { ensureCommentDmLink } from "../lib/keyword-dm";
import { igConfigured } from "../lib/instagram";
import { editorsOnly, workspaceCtx } from "../middleware/auth";
import { statsByLink } from "../lib/link-stats";
import { brandSender } from "./instagram";
import { DEFAULT_PUBLIC_REPLIES } from "../../shared/performance";
import { igConnectionState, igConnectionUsable, igConnectionUsableSql } from "../lib/ig-connection-state";
import { dmPolicyStatus, productionDmPolicy, requireDmPolicy, type DmPolicy } from "../lib/message-policy";

const ruleSchema = z.object({
  guideId: z.string().min(1, "가이드를 골라 주세요."),
  influencerId: z.string().min(1, "인플루언서를 골라 주세요."),
  igMediaId: z.string().trim().min(1, "게시물을 골라 주세요."),
  mediaThumbUrl: z.string().max(2000).nullable().optional(),
  mediaPermalink: z.string().max(500).nullable().optional(),
  keywords: z.array(z.string().trim().min(1).max(30)).min(1, "키워드를 하나 이상 넣어 주세요.").max(10),
  message: z.string().trim().min(1).max(900).refine((m) => m.includes("{link}"), "DM 문구에 {link} 를 넣어 주세요."),
  publicReplyVariants: z.array(z.string().trim().min(1).max(100)).max(3),
});

async function ownRule(db: Db, workspaceId: string, id: string) {
  const r = await db.select().from(keywordDmRules).where(and(eq(keywordDmRules.id, id), eq(keywordDmRules.workspaceId, workspaceId))).get();
  if (!r) throw new ApiError(404, "rule_not_found", "규칙을 찾을 수 없어요.");
  return r;
}

async function checkRefs(db: Db, workspaceId: string, guideId: string, influencerId: string) {
  const g = await db.select({ id: guides.id }).from(guides).where(and(eq(guides.id, guideId), eq(guides.workspaceId, workspaceId))).get();
  const i = await db.select({ id: influencers.id }).from(influencers).where(and(eq(influencers.id, influencerId), eq(influencers.workspaceId, workspaceId))).get();
  if (!g || !i) throw new ApiError(404, "ref_not_found", "가이드 또는 인플루언서를 찾을 수 없어요.");
}

export function createKeywordDmRoutes(policy: DmPolicy = productionDmPolicy) {
  return new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const rules = await db
      .select({ rule: keywordDmRules, guideName: guides.name, influencerName: influencers.displayName })
      .from(keywordDmRules)
      .leftJoin(guides, eq(guides.id, keywordDmRules.guideId))
      .leftJoin(influencers, eq(influencers.id, keywordDmRules.influencerId))
      .where(eq(keywordDmRules.workspaceId, workspace.id))
      .orderBy(desc(keywordDmRules.createdAt));
    const ids = rules.map((r) => r.rule.id);
    const dayStart = new Date().setHours(0, 0, 0, 0);
    const today = ids.length
      ? await db.select({ ruleId: keywordDmSends.ruleId, n: count() }).from(keywordDmSends).where(and(inArray(keywordDmSends.ruleId, ids), eq(keywordDmSends.status, "sent"), gte(keywordDmSends.sentAt, dayStart))).groupBy(keywordDmSends.ruleId)
      : [];
    const stats = await statsByLink(db, workspace.id);
    const links = await db.select().from(shortLinks).where(and(eq(shortLinks.workspaceId, workspace.id), eq(shortLinks.channelKey, "ig_comment_dm"), isNull(shortLinks.deletedAt)));
    const conn = await brandSender(db, workspace.id);
    return c.json({
      configured: igConfigured(c.env),
      sendPolicy: dmPolicyStatus(policy),
      connection: conn?.connectedAt ? { username: conn.username, ...igConnectionState(conn) } : null,
      defaultPublicReplies: DEFAULT_PUBLIC_REPLIES,
      rules: rules.map(({ rule, guideName, influencerName }) => {
        const link = links.find((l) => l.guideId === rule.guideId && l.influencerId === rule.influencerId);
        const s = link ? stats.get(link.id) : undefined;
        return {
          ...rule,
          guideName,
          influencerName,
          todaySent: today.find((t) => t.ruleId === rule.id)?.n ?? 0,
          clicks: s?.clicks ?? 0,
          leads: s?.leads ?? 0,
          linkUrl: link ? `${c.env.PUBLIC_SHORT_BASE}/${link.slug}` : null,
        };
      }),
    });
  })
  .post("/", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const body = parse(ruleSchema, await c.req.json());
    await checkRefs(c.var.db, workspace.id, body.guideId, body.influencerId);
    const conn = await brandSender(c.var.db, workspace.id);
    const id = newId();
    await c.var.db.insert(keywordDmRules).values({
      id,
      workspaceId: workspace.id,
      ...body,
      mediaThumbUrl: body.mediaThumbUrl ?? null,
      mediaPermalink: body.mediaPermalink ?? null,
      igConnectionId: conn?.id ?? null,
      enabled: false,
      status: "off",
      createdAt: now(),
      updatedAt: now(),
    });
    await logEvent(c.var.db, workspace.id, "keyword_dm_rule_created", { keyword_count: body.keywords.length });
    return c.json({ id }, 201);
  })
  // 내용이 바뀌면 규칙을 끈다 (4-2: 켜는 것이 브랜드의 보내기 확인)
  .patch("/:id", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const rule = await ownRule(c.var.db, workspace.id, c.req.param("id"));
    const body = parse(ruleSchema, await c.req.json());
    await checkRefs(c.var.db, workspace.id, body.guideId, body.influencerId);
    await c.var.db
      .update(keywordDmRules)
      .set({ ...body, mediaThumbUrl: body.mediaThumbUrl ?? null, mediaPermalink: body.mediaPermalink ?? null, enabled: false, status: "off", pausedReason: null, updatedAt: now() })
      .where(eq(keywordDmRules.id, rule.id));
    return c.json({ ok: true, turnedOff: rule.status === "on" });
  })
  .post("/:id/toggle", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const rule = await ownRule(db, workspace.id, c.req.param("id"));
    const { on } = parse(z.object({ on: z.boolean() }), await c.req.json());
    if (on) {
      requireDmPolicy(policy);
      if (!igConfigured(c.env)) throw new ApiError(409, "not_configured", "인스타그램 연결 준비 중이라 아직 켤 수 없어요.");
      const conn = await brandSender(db, workspace.id);
      if (!conn || !igConnectionUsable(conn)) throw new ApiError(409, "not_connected", "먼저 연동 화면에서 브랜드 인스타그램 계정을 다시 연결해 주세요.");
      const link = await ensureCommentDmLink(db, rule);
      if (!link) throw new ApiError(409, "no_link", "이 가이드에 리드 링크가 없어요. 리드 링크 탭에서 먼저 발급해 주세요.");
      const changed = await db.update(keywordDmRules).set({ igConnectionId: conn.id, enabled: true, status: "on", pausedReason: null, updatedAt: now() })
        .where(and(eq(keywordDmRules.id, rule.id), eq(keywordDmRules.workspaceId, workspace.id), sql`EXISTS(SELECT 1 FROM ig_connections g
          WHERE g.id=${conn.id} AND g.workspace_id=${workspace.id} AND g.generation=${conn.generation} AND ${igConnectionUsableSql("g")})`)).returning({ id: keywordDmRules.id });
      if (!changed.length) throw new ApiError(409, "connection_changed", "연결 상태가 바뀌었어요. 새로고침한 뒤 다시 시도해 주세요.");
    } else {
      await db.update(keywordDmRules).set({ enabled: false, status: "off", updatedAt: now() }).where(eq(keywordDmRules.id, rule.id));
    }
    await logEvent(db, workspace.id, "keyword_dm_rule_toggled", { on });
    return c.json({ ok: true });
  })
  .delete("/:id", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const rule = await ownRule(c.var.db, workspace.id, c.req.param("id"));
    await c.var.db.delete(keywordDmRules).where(eq(keywordDmRules.id, rule.id));
    return c.json({ ok: true });
  })
  .get("/:id/sends", async (c) => {
    const { workspace } = workspaceCtx(c);
    const rule = await ownRule(c.var.db, workspace.id, c.req.param("id"));
    // Keep the existing DTO; consent hashes and attempt authority stay internal.
    const sends = await c.var.db.select({ id: keywordDmSends.id, ruleId: keywordDmSends.ruleId, commentId: keywordDmSends.commentId, igUserId: keywordDmSends.igUserId,
      username: keywordDmSends.username, commentText: keywordDmSends.commentText, commentAt: keywordDmSends.commentAt, sentAt: keywordDmSends.sentAt,
      status: keywordDmSends.status, reason: keywordDmSends.reason, linkId: keywordDmSends.linkId })
      .from(keywordDmSends).where(eq(keywordDmSends.ruleId, rule.id)).orderBy(desc(keywordDmSends.commentAt)).limit(200);
    return c.json({ sends });
  });
}
export const keywordDmRoutes = createKeywordDmRoutes();
