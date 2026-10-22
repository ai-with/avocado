import { Hono, type Context } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { guidelineSets, guides } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, newToken, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { findGuide, guideRules } from "../../lib/guides";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { forbiddenTerms, lineWarnings, makeSlug, ruleConflicts, type GuideRule, type VideoGuide } from "../../../shared/guides";
import { GUIDE_DEFAULTS, guideCreate, guidePatch, withRuleIds } from "./schemas";
import { generateDraft } from "./generate";

// 가이드 (F-56, F-57)

async function uniqueSlug(db: Db, name: string) {
  const random = () => newToken(6).toLowerCase().replace(/[^a-z0-9]/g, "x").slice(0, 6);
  let slug = makeSlug(name, random);
  while (await db.select({ id: guides.id }).from(guides).where(eq(guides.slug, slug)).get()) slug = `${makeSlug(name, random)}-${random().slice(0, 3)}`;
  return slug;
}

async function checkSet(db: Db, workspaceId: string, setId: string | null | undefined) {
  if (!setId) return;
  const s = await db.select({ id: guidelineSets.id }).from(guidelineSets).where(and(eq(guidelineSets.id, setId), eq(guidelineSets.workspaceId, workspaceId))).get();
  if (!s) throw new ApiError(400, "set_not_found", "규정 세트를 찾을 수 없습니다.", { guidelineSetId: "규정 세트를 찾을 수 없습니다." });
}

async function guideWarnings(db: Db, guide: { guidelineSetId: string | null; extraRules: GuideRule[]; videoGuide: VideoGuide | null }) {
  const rules = await guideRules(db, guide);
  return { rules, warnings: ruleConflicts(rules), lineWarnings: guide.videoGuide ? lineWarnings(guide.videoGuide, forbiddenTerms(rules)) : [] };
}

// 상세·생성·수정 응답 공통: 가이드 + 규칙 경고 + 공용 링크
async function guideDetail(c: Context<AppEnv>, g: typeof guides.$inferSelect) {
  return { guide: g, ...(await guideWarnings(c.var.db, g)), sharedUrl: `${c.env.APP_URL}/g/${g.slug}` };
}

function ownGuide(c: Context<AppEnv>) {
  const { workspace } = workspaceCtx(c);
  return findGuide(c.var.db, workspace.id, c.req.param("id") ?? "");
}

export const guideCrudRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const list = await c.var.db
      .select({
        id: guides.id,
        name: guides.name,
        status: guides.status,
        createdAt: guides.createdAt,
        influencerCount: sql<number>`(SELECT count(*) FROM guide_influencers gi WHERE gi.guide_id = guides.id)`,
        viewedCount: sql<number>`(SELECT count(DISTINCT v.guide_influencer_id) FROM guide_views v JOIN guide_influencers gi ON gi.id = v.guide_influencer_id WHERE gi.guide_id = guides.id)`,
        uploadCount: sql<number>`(SELECT count(*) FROM submissions s JOIN guide_influencers gi ON gi.id = s.guide_influencer_id WHERE gi.guide_id = guides.id AND s.status NOT IN ('uploading', 'aborted'))`,
      })
      .from(guides)
      .where(eq(guides.workspaceId, workspace.id))
      .orderBy(desc(guides.createdAt));
    return c.json({ guides: list });
  })
  .post("/", editorsOnly, async (c) => {
    const body = { ...GUIDE_DEFAULTS, ...parse(guideCreate, await c.req.json()) };
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    await checkSet(db, workspace.id, body.guidelineSetId);
    const id = newId();
    const videoGuide = body.videoGuide ? { ...body.videoGuide, draft: false } : null;
    await db.insert(guides).values({ id, workspaceId: workspace.id, slug: await uniqueSlug(db, body.name), ...body, extraRules: withRuleIds(body.extraRules), videoGuide, createdAt: now(), updatedAt: now() });
    if (videoGuide) await logEvent(db, workspace.id, "video_guide_saved", { guide_id: id });
    return c.json(await guideDetail(c, await findGuide(db, workspace.id, id)), 201);
  })
  .get("/:id", async (c) => c.json(await guideDetail(c, await ownGuide(c))))
  .patch("/:id", editorsOnly, async (c) => {
    const body = parse(guidePatch, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const g = await ownGuide(c);
    await checkSet(db, workspace.id, body.guidelineSetId);
    // 브랜드가 저장한 가이드는 더 이상 '초안'이 아니다 (F-56 정책)
    const videoGuide = body.videoGuide ? { ...body.videoGuide, draft: false } : body.videoGuide;
    await db
      .update(guides)
      .set({ ...body, extraRules: body.extraRules ? withRuleIds(body.extraRules) : undefined, videoGuide, updatedAt: now() })
      .where(eq(guides.id, g.id));
    if (body.videoGuide) await logEvent(db, workspace.id, "video_guide_saved", { guide_id: g.id });
    return c.json(await guideDetail(c, await findGuide(db, workspace.id, g.id)));
  })
  .delete("/:id", editorsOnly, async (c) => {
    const g = await ownGuide(c);
    await c.var.db.delete(guides).where(eq(guides.id, g.id));
    return c.json({ ok: true });
  })
  .post("/:id/generate", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const g = await ownGuide(c);
    if (!g.product.name) throw new ApiError(400, "product_required", "제품 이름을 먼저 입력해 주세요.", { "product.name": "제품 이름을 입력해 주세요." });
    const started = now();
    const rules = await guideRules(db, g);
    const result = await generateDraft(c.env, g, rules);
    const latency = now() - started;
    if (result.model) await db.update(guides).set({ generatedByModel: result.model }).where(eq(guides.id, g.id));
    await logEvent(db, workspace.id, "video_guide_generated", { latency_ms: latency, fallback: result.fallback });
    return c.json({ videoGuide: result.guide, fallback: result.fallback, model: result.model, latencyMs: latency, lineWarnings: lineWarnings(result.guide, forbiddenTerms(rules)) });
  })
  .post("/:id/publish", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const g = await ownGuide(c);
    if (!g.product.name) throw new ApiError(400, "product_required", "제품 이름을 입력해야 발행할 수 있습니다.");
    if (g.status !== "published") {
      await db.update(guides).set({ status: "published", publishedAt: now(), updatedAt: now() }).where(eq(guides.id, g.id));
      await logEvent(db, workspace.id, "guide_created", { guide_id: g.id });
    }
    return c.json({ guide: await findGuide(db, workspace.id, g.id), sharedUrl: `${c.env.APP_URL}/g/${g.slug}` });
  })
  .post("/:id/unpublish", editorsOnly, async (c) => {
    const g = await ownGuide(c);
    await c.var.db.update(guides).set({ status: "draft", updatedAt: now() }).where(eq(guides.id, g.id));
    return c.json({ ok: true });
  });
