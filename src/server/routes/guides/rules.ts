import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { guidelineRules, guidelineSets } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { findOwned } from "../../lib/owned";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { DEFAULT_AD_RULE, ruleConflicts } from "../../../shared/guides";
import { ruleBody } from "./schemas";

// 규정 세트 (F-55)

function findSet(c: Context<AppEnv>, id: string) {
  const { workspace } = workspaceCtx(c);
  return findOwned(c.var.db, guidelineSets, id, workspace.id, { code: "set_not_found", message: "규정 세트를 찾을 수 없어요." });
}

// 규칙이 바뀔 때마다 세트 버전을 올리고 새 버전 번호를 돌려준다
async function bumpSet(db: Db, setId: string) {
  const row = await db
    .update(guidelineSets)
    .set({ version: sql`${guidelineSets.version} + 1`, updatedAt: now() })
    .where(eq(guidelineSets.id, setId))
    .returning({ version: guidelineSets.version })
    .get();
  return row?.version ?? 1;
}

async function setDetail(db: Db, setId: string) {
  const set = await db.select().from(guidelineSets).where(eq(guidelineSets.id, setId)).get();
  const rules = await db.select().from(guidelineRules).where(eq(guidelineRules.setId, setId)).orderBy(asc(guidelineRules.createdAt));
  return { set, rules, warnings: ruleConflicts(rules) };
}

const setName = z.object({ name: z.string().trim().min(1, "이름을 입력해 주세요.").max(60) });

export const guidelineRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const list = await c.var.db
      .select({ id: guidelineSets.id, name: guidelineSets.name, version: guidelineSets.version, updatedAt: guidelineSets.updatedAt, ruleCount: sql<number>`(SELECT count(*) FROM guideline_rules r WHERE r.set_id = guideline_sets.id)` })
      .from(guidelineSets)
      .where(eq(guidelineSets.workspaceId, workspace.id))
      .orderBy(desc(guidelineSets.updatedAt));
    return c.json({ sets: list });
  })
  .post("/", editorsOnly, async (c) => {
    const { name } = parse(setName, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const id = newId();
    await db.batch([
      db.insert(guidelineSets).values({ id, workspaceId: workspace.id, name, version: 1, createdAt: now(), updatedAt: now() }),
      db.insert(guidelineRules).values({ id: newId(), setId: id, ...DEFAULT_AD_RULE, version: 1, createdAt: now() }),
    ]);
    await logEvent(db, workspace.id, "guideline_set_created", { rule_count: 1 });
    return c.json(await setDetail(db, id), 201);
  })
  .get("/:id", async (c) => {
    const s = await findSet(c, c.req.param("id"));
    return c.json(await setDetail(c.var.db, s.id));
  })
  .patch("/:id", editorsOnly, async (c) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(60) }), await c.req.json());
    const s = await findSet(c, c.req.param("id"));
    await c.var.db.update(guidelineSets).set({ name, updatedAt: now() }).where(eq(guidelineSets.id, s.id));
    return c.json(await setDetail(c.var.db, s.id));
  })
  .delete("/:id", editorsOnly, async (c) => {
    const s = await findSet(c, c.req.param("id"));
    await c.var.db.delete(guidelineSets).where(eq(guidelineSets.id, s.id));
    return c.json({ ok: true });
  })
  .post("/:id/rules", editorsOnly, async (c) => {
    const body = parse(ruleBody, await c.req.json());
    const s = await findSet(c, c.req.param("id"));
    const db = c.var.db;
    const version = await bumpSet(db, s.id);
    await db.insert(guidelineRules).values({ id: newId(), setId: s.id, ...body, version, createdAt: now() });
    await logEvent(db, s.workspaceId, "guideline_rule_added", { type: body.type, severity: body.severity });
    return c.json(await setDetail(db, s.id), 201);
  })
  .patch("/:id/rules/:ruleId", editorsOnly, async (c) => {
    const body = parse(ruleBody.partial(), await c.req.json());
    const s = await findSet(c, c.req.param("id"));
    const db = c.var.db;
    const rule = await db.select().from(guidelineRules).where(and(eq(guidelineRules.id, c.req.param("ruleId")), eq(guidelineRules.setId, s.id))).get();
    if (!rule) throw new ApiError(404, "rule_not_found", "규칙을 찾을 수 없어요.");
    const version = await bumpSet(db, s.id);
    await db.update(guidelineRules).set({ ...body, version }).where(eq(guidelineRules.id, rule.id));
    if (body.enabled === false && rule.enabled) await logEvent(db, s.workspaceId, "guideline_rule_disabled", { type: rule.type });
    return c.json(await setDetail(db, s.id));
  })
  .delete("/:id/rules/:ruleId", editorsOnly, async (c) => {
    const s = await findSet(c, c.req.param("id"));
    const db = c.var.db;
    await db.delete(guidelineRules).where(and(eq(guidelineRules.id, c.req.param("ruleId")), eq(guidelineRules.setId, s.id)));
    await bumpSet(db, s.id);
    return c.json(await setDetail(db, s.id));
  });
