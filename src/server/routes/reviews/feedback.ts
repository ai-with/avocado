import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { feedbackItems } from "../../db/schema";
import { parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { translate } from "../../lib/ai";
import { editorsOnly } from "../../middleware/auth";
import { BRAND_LANG, assertUnlocked, feedbackBody, loadSub, shapeSchema } from "./shared";

// 보내기 전 피드백 초안 (라운드가 없는 항목)

const patchBody = z.object({ text: z.string().trim().min(1).max(2000).optional(), shape: shapeSchema.optional(), textTranslated: z.string().max(4000).nullable().optional() });
const draftOf = (submissionId: string, itemId: string) => and(eq(feedbackItems.id, itemId), eq(feedbackItems.submissionId, submissionId), isNull(feedbackItems.roundId));

export const feedbackRoutes = new Hono<AppEnv>()
  .post("/:id/feedback", editorsOnly, async (c) => {
    const body = parse(feedbackBody, await c.req.json());
    const db = c.var.db;
    const { sub, gi, workspace, user } = await loadSub(c, c.req.param("id"));
    await assertUnlocked(db, sub);
    await db.insert(feedbackItems).values({ id: newId(), submissionId: sub.id, frameId: body.frameId, tMs: body.tMs, shape: body.shape, text: body.text, source: "manual", authorId: user.id, createdAt: now() });
    await logEvent(db, workspace.id, "feedback_comment_added", { source: "manual" });
    return c.json({ ok: true }, 201);
  })
  .patch("/:id/feedback/:itemId", editorsOnly, async (c) => {
    const body = parse(patchBody, await c.req.json());
    const db = c.var.db;
    const { sub, gi } = await loadSub(c, c.req.param("id"));
    await assertUnlocked(db, sub);
    // 번역문을 직접 고치지 않았는데 원문이 바뀌면 번역은 다시 만든다
    const patch = { ...body, ...(body.text !== undefined && body.textTranslated === undefined ? { textTranslated: null } : {}) };
    await db.update(feedbackItems).set(patch).where(draftOf(sub.id, c.req.param("itemId")));
    return c.json({ ok: true });
  })
  .delete("/:id/feedback/:itemId", editorsOnly, async (c) => {
    const db = c.var.db;
    const { sub, gi } = await loadSub(c, c.req.param("id"));
    await assertUnlocked(db, sub);
    await db.delete(feedbackItems).where(draftOf(sub.id, c.req.param("itemId")));
    return c.json({ ok: true });
  })
  // 전송 전 번역 미리보기 (F-62 정책: 필수). 인플루언서 언어가 한국어면 번역하지 않는다
  .post("/:id/feedback/translate", editorsOnly, async (c) => {
    const db = c.var.db;
    const { sub, influencer, workspace } = await loadSub(c, c.req.param("id"));
    const drafts = await db.select().from(feedbackItems).where(and(eq(feedbackItems.submissionId, sub.id), isNull(feedbackItems.roundId))).orderBy(asc(feedbackItems.tMs));
    const to = influencer.lang;
    const failed: string[] = [];
    const out = [];
    for (const d of drafts) {
      let t = d.textTranslated;
      if (to !== BRAND_LANG && !t) {
        t = await translate(c.env, d.text, BRAND_LANG, to).catch((e: unknown) => {
          console.error("[feedback:translate]", d.id, e);
          return null;
        });
        if (t) await db.update(feedbackItems).set({ textTranslated: t }).where(eq(feedbackItems.id, d.id));
        else failed.push(d.id);
      }
      out.push({ id: d.id, tMs: d.tMs, text: d.text, textTranslated: to === BRAND_LANG ? null : t });
    }
    if (to !== BRAND_LANG && out.length > failed.length) await logEvent(db, workspace.id, "feedback_translated", { from: BRAND_LANG, to });
    return c.json({ lang: to, items: out, failed });
  });
