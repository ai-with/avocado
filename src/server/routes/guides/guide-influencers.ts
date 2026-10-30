import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { consents, guideInfluencers, influencers } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { sendEmail } from "../../lib/email";
import { findOwned } from "../../lib/owned";
import { findGuide, findGuideInfluencer, guideLinks, issueTokens, linkInfluencer } from "../../lib/guides";
import { guideInviteMail } from "../../lib/influencer-mails";
import { brandNameOf } from "../../lib/brands";
import { stageSummaries } from "../../lib/guide-status";
import { contractOf, roundsFor } from "../../lib/participation";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { influencerBody, influencerValues } from "./schemas";

// 가이드 상세의 인플루언서 탭 (/api/guides/:id/influencers...)

function ownGuide(c: Context<AppEnv>) {
  const { workspace } = workspaceCtx(c);
  return findGuide(c.var.db, workspace.id, c.req.param("id") ?? "");
}

const linkNotFound = () => new ApiError(404, "link_not_found", "인플루언서 링크를 찾을 수 없어요.");

export const guideInfluencerRoutes = new Hono<AppEnv>()
  // 행마다 단계 상태 한 줄
  .get("/:id/influencers", async (c) => {
    const db = c.var.db;
    const g = await ownGuide(c);
    const rows = await db
      .select({ gi: guideInfluencers, influencer: influencers })
      .from(guideInfluencers)
      .innerJoin(influencers, eq(influencers.id, guideInfluencers.influencerId))
      .where(eq(guideInfluencers.guideId, g.id))
      .orderBy(asc(guideInfluencers.createdAt));
    const summaries = await stageSummaries(db, g.id);
    const rounds = await roundsFor(db, g.workspaceId, rows.map((r) => r.influencer.id));
    return c.json({
      rows: rows.map((r) => ({
        id: r.gi.id,
        influencer: r.influencer,
        stage: r.gi.stage,
        tokenExpiresAt: r.gi.tokenExpiresAt,
        links: guideLinks(c.env, r.gi),
        status: summaries.get(r.gi.id),
        // TASK-072: 진행 상태·조건·브랜드 안 참여 회차, 계약 기간(컬럼은 TASK-074)
        participationStatus: r.gi.status,
        terms: r.gi.terms,
        round: rounds.get(r.gi.id) ?? 1,
        ...contractOf(r.gi),
      })),
    });
  })
  // 기존 인플루언서를 고르거나 새로 만들어 연결한다
  .post("/:id/influencers", editorsOnly, async (c) => {
    const body = parse(z.union([z.object({ influencerId: z.string() }), influencerBody]), await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const g = await ownGuide(c);
    let influencerId: string;
    if ("influencerId" in body) {
      const notFound = { code: "influencer_not_found", message: "인플루언서를 찾을 수 없어요." };
      influencerId = (await findOwned(db, influencers, body.influencerId, workspace.id, notFound)).id;
    } else {
      influencerId = newId();
      await db.insert(influencers).values({ id: influencerId, workspaceId: workspace.id, ...influencerValues(body), createdAt: now() });
    }
    const gi = await linkInfluencer(db, workspace.id, g.id, influencerId);
    return c.json({ id: gi.id, links: guideLinks(c.env, gi) }, 201);
  })
  .post("/:id/influencers/:giId/reissue", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const g = await ownGuide(c);
    const row = await db
      .update(guideInfluencers)
      .set(issueTokens())
      .where(and(eq(guideInfluencers.id, c.req.param("giId")), eq(guideInfluencers.guideId, g.id)))
      .returning()
      .get();
    if (!row) throw linkNotFound();
    await logEvent(db, workspace.id, "guide_link_issued", { guide_id: g.id, reissue: true });
    return c.json({ links: guideLinks(c.env, row), tokenExpiresAt: row.tokenExpiresAt });
  })
  .delete("/:id/influencers/:giId", editorsOnly, async (c) => {
    const g = await ownGuide(c);
    await c.var.db.delete(guideInfluencers).where(and(eq(guideInfluencers.id, c.req.param("giId")), eq(guideInfluencers.guideId, g.id)));
    return c.json({ ok: true });
  })
  .get("/:id/influencers/:giId/consents", async (c) => {
    const db = c.var.db;
    const g = await ownGuide(c);
    const gi = await findGuideInfluencer(db, g.id, c.req.param("giId"));
    const list = await db.select().from(consents).where(eq(consents.guideInfluencerId, gi.id)).orderBy(desc(consents.agreedAt));
    // IP 는 브랜드에 보여 주지 않는다 (입증용 보관)
    return c.json({ consents: list.map(({ ip: _ip, ...rest }) => rest) });
  })
  // "인플루언서에게 어떻게 보낼까요?" 이메일 보내기. 사람이 버튼을 눌러야 나간다 (4-2)
  .post("/:id/influencers/:giId/email", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const g = await ownGuide(c);
    if (g.status !== "published") throw new ApiError(400, "not_published", "가이드를 발행한 뒤에 보낼 수 있어요.");
    const row = await db
      .select({ gi: guideInfluencers, influencer: influencers })
      .from(guideInfluencers)
      .innerJoin(influencers, eq(influencers.id, guideInfluencers.influencerId))
      .where(and(eq(guideInfluencers.id, c.req.param("giId")), eq(guideInfluencers.guideId, g.id)))
      .get();
    if (!row) throw linkNotFound();
    if (!row.influencer.email) throw new ApiError(400, "no_email", "인플루언서 이메일이 없어요. 링크를 복사해 DM으로 보내 주세요.");
    const who = { brand: await brandNameOf(db, workspace.id, g.id), name: row.influencer.displayName, en: row.influencer.lang === "en", url: guideLinks(c.env, row.gi).guide };
    const email = await sendEmail(c.env, { to: row.influencer.email, ...guideInviteMail(who) });
    if (email.delivered) await logEvent(db, workspace.id, "guide_email_sent", { guide_id: g.id, gi_id: row.gi.id });
    return c.json({ email });
  });
