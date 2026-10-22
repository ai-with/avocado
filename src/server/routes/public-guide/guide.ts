import { Hono } from "hono";
import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { consents, guideInfluencers, guideViews, guides, influencers, workspaces } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent, logEvents } from "../../lib/events";
import { influencerLeadLinks } from "../../lib/guide-status";
import { guideLinks, linkInfluencer, linkNotFound } from "../../lib/guides";
import { cancelProcessingFor } from "../../pipeline";
import { CONSENT_DOC_VERSION, missingConsent } from "../../../shared/guides";
import { byToken, currentConsent, notifyOwners, publicGuideBody, requireByToken } from "./shared";

// 가이드 열람, 공용 링크 참여, 동의와 철회 (F-57, F-58)

const consentBody = z.object({
  items: z.record(z.string(), z.boolean()),
  name: z.string().trim().min(1, "이름을 입력해 주세요.").max(60),
  email: z.email("이메일 형식이 아닙니다."),
  country: z.string().trim().toUpperCase().length(2, "국가를 골라 주세요."),
  ageConfirmed: z.boolean(),
});
const joinBody = z.object({
  displayName: z.string().trim().min(1, "이름을 입력해 주세요.").max(60),
  igHandle: z.string().trim().max(60).default(""),
  email: z.union([z.literal(""), z.email("이메일 형식이 아닙니다.")]).default(""),
  lang: z.enum(["ko", "en"]).default("ko"),
});
type Row = NonNullable<Awaited<ReturnType<typeof byToken>>>;

const publishedBySlug = (db: Db, slug: string) => db.select().from(guides).where(and(eq(guides.slug, slug), eq(guides.status, "published"))).get();

// 열 때마다 열람 기록. 처음 열면 단계가 '열람'으로 바뀐다
async function recordView(db: Db, row: Row, lang: string) {
  const { gi, guide } = row;
  const seen = await db.select({ n: count() }).from(guideViews).where(eq(guideViews.guideInfluencerId, gi.id)).get();
  const firstOpen = (seen?.n ?? 0) === 0;
  await db.insert(guideViews).values({ id: newId(), guideInfluencerId: gi.id, openedAt: now(), lang, firstOpen });
  if (gi.stage === "invited") await db.update(guideInfluencers).set({ stage: "viewed" }).where(eq(guideInfluencers.id, gi.id));
  await logEvent(db, guide.workspaceId, "guide_link_opened", { lang, first_open: firstOpen });
}

function validateConsent(body: z.infer<typeof consentBody>) {
  const missing = missingConsent(body.items);
  if (missing.length) throw new ApiError(400, "consent_missing", "필수 항목에 모두 동의해야 참여할 수 있습니다.", Object.fromEntries(missing.map((k) => [`items.${k}`, "필수 항목입니다."])));
  if (!body.ageConfirmed) throw new ApiError(400, "age_required", "만 18세 이상만 참여할 수 있습니다.", { ageConfirmed: "만 18세 이상만 참여할 수 있습니다." });
}

async function saveConsent(db: Db, row: Row, body: z.infer<typeof consentBody>, ip: string | null) {
  const { gi, guide, influencer } = row;
  const agreedAt = now();
  await db.insert(consents).values({ id: newId(), guideInfluencerId: gi.id, docVersion: CONSENT_DOC_VERSION, items: body.items, secondaryUseScope: guide.secondaryUseScope, name: body.name, email: body.email, country: body.country, ageConfirmed: body.ageConfirmed, ip, agreedAt });
  await db.update(guideInfluencers).set({ stage: "consented" }).where(eq(guideInfluencers.id, gi.id));
  if (!influencer.email || !influencer.country)
    await db.update(influencers).set({ email: influencer.email ?? body.email, country: influencer.country ?? body.country }).where(eq(influencers.id, influencer.id));
  return agreedAt;
}

export const publicGuideViewRoutes = new Hono<AppEnv>()
  // 인플루언서별 가이드 또는 가이드 공용 링크(slug)
  .get("/guide/:token", async (c) => {
    const db = c.var.db;
    const token = c.req.param("token");
    const row = await byToken(db, "guideToken", token);
    if (!row) {
      const guide = await publishedBySlug(db, token);
      if (!guide) throw linkNotFound();
      const ws = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, guide.workspaceId)).get();
      return c.json({ mode: "shared", lang: guide.lang, guide: await publicGuideBody(db, guide, ws?.name ?? "") });
    }
    const { gi, guide, influencer, workspaceName } = row;
    const q = c.req.query("lang");
    await recordView(db, row, q === "ko" || q === "en" ? q : influencer.lang);
    const consent = await currentConsent(db, gi.id);
    return c.json({
      mode: "personal",
      lang: influencer.lang,
      influencer: { displayName: influencer.displayName, email: influencer.email, country: influencer.country },
      guide: await publicGuideBody(db, guide, workspaceName),
      consent: consent ? { agreedAt: consent.agreedAt, docVersion: consent.docVersion } : null,
      uploadUrl: consent ? guideLinks(c.env, gi).upload : null,
      leadLinks: await influencerLeadLinks(db, c.env.PUBLIC_SHORT_BASE, guide.id, influencer.id),
      consentDocVersion: CONSENT_DOC_VERSION,
    });
  })
  // 공용 링크로 들어온 인플루언서가 이름·계정을 넣으면 본인 링크를 만든다
  // ponytail: 공개 가입이라 스팸 방어 없음. 남용되면 Turnstile 이나 IP 속도 제한을 붙인다
  .post("/guide/:slug/join", async (c) => {
    const body = parse(joinBody, await c.req.json());
    const db = c.var.db;
    const guide = await publishedBySlug(db, c.req.param("slug"));
    if (!guide) throw new ApiError(404, "link_not_found", "링크를 찾을 수 없습니다.");
    const influencerId = newId();
    await db.insert(influencers).values({ id: influencerId, workspaceId: guide.workspaceId, displayName: body.displayName, igHandle: body.igHandle.replace(/^@/, "") || null, email: body.email || null, lang: body.lang, createdAt: now() });
    const gi = await linkInfluencer(db, guide.workspaceId, guide.id, influencerId);
    return c.json({ guideToken: gi.guideToken }, 201);
  })
  .post("/guide/:token/consent", async (c) => {
    const body = parse(consentBody, await c.req.json());
    const db = c.var.db;
    const row = await requireByToken(db, "guideToken", c.req.param("token"));
    const { gi, guide, influencer } = row;
    validateConsent(body);
    if (await currentConsent(db, gi.id)) throw new ApiError(409, "already_consented", "이미 동의를 완료했습니다.");
    const agreedAt = await saveConsent(db, row, body, c.req.header("cf-connecting-ip") ?? null);
    await logEvents(db, guide.workspaceId, [
      ["participation_accepted", { guide_id: guide.id }],
      ["consent_submitted", { version: CONSENT_DOC_VERSION, country: body.country, optional_items: body.items.secondary_use === true ? ["secondary_use"] : [] }],
    ]);
    c.executionCtx.waitUntil(notifyOwners(c.env, db, guide.workspaceId, `[${guide.name}] ${influencer.displayName}님이 참여에 동의했습니다`, `${influencer.displayName}님이 가이드 "${guide.name}" 참여에 동의했습니다. 이제 영상을 올릴 수 있습니다.`));
    return c.json({ uploadUrl: guideLinks(c.env, gi).upload, agreedAt }, 201);
  })
  .post("/guide/:token/withdraw", async (c) => {
    const db = c.var.db;
    const { gi, guide, influencer } = await requireByToken(db, "guideToken", c.req.param("token"));
    const consent = await currentConsent(db, gi.id);
    if (!consent) throw new ApiError(400, "no_consent", "철회할 동의가 없습니다.");
    await db.update(consents).set({ withdrawnAt: now() }).where(eq(consents.id, consent.id));
    await db.update(guideInfluencers).set({ stage: "withdrawn" }).where(eq(guideInfluencers.id, gi.id));
    await logEvent(db, guide.workspaceId, "consent_withdrawn", { guide_id: guide.id });
    // TASK-020: 대기·진행 중인 처리 작업 취소. 원본·프레임·전사 삭제 예약은 보관 정책 작업(7-1) 때 붙인다
    await cancelProcessingFor(db, gi.id);
    c.executionCtx.waitUntil(notifyOwners(c.env, db, guide.workspaceId, `[${guide.name}] ${influencer.displayName}님이 동의를 철회했습니다`, `${influencer.displayName}님이 가이드 "${guide.name}" 동의를 철회했습니다. 처리 중인 작업은 멈추고 원본·프레임·전사는 삭제 예정입니다. 이미 내려받은 파일은 브랜드가 관리해야 합니다.`));
    return c.json({ ok: true });
  });
