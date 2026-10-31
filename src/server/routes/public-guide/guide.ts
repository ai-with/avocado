import { Hono } from "hono";
import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { consents, guideInfluencers, guideViews, guides, influencers } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent, logEvents } from "../../lib/events";
import { influencerLeadLinks } from "../../lib/guide-status";
import { linkNotFound } from "../../lib/guides";
import { joinPublicGuide, publicJoinChallenge } from "../../lib/guide-join";
import { cancelProcessingFor } from "../../pipeline";
import { publicGuideInstagram } from "../../lib/instagram-oauth";
import { CONSENT_DOC_VERSION, missingConsent } from "../../../shared/guides";
import { brandNameOf } from "../../lib/brands";
import { withdrawMedia } from "../../lib/media-purge";
import { byToken, currentConsent, influencerTabs, notifyOwners, publicGuideBody, requireByToken } from "./shared";

// 가이드 열람, 공용 링크 참여, 동의와 철회 (F-57, F-58)

const consentBody = z.object({
  items: z.record(z.string(), z.boolean()),
  name: z.string().trim().min(1, "이름을 입력해 주세요.").max(60),
  email: z.email("이메일 형식이 아니에요."),
  country: z.string().trim().toUpperCase().length(2, "국가를 골라 주세요."),
  ageConfirmed: z.boolean(),
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
  if (missing.length) throw new ApiError(400, "consent_missing", "필수 항목에 모두 동의해야 참여할 수 있어요.", Object.fromEntries(missing.map((k) => [`items.${k}`, "필수 항목이에요."])));
  if (!body.ageConfirmed) throw new ApiError(400, "age_required", "만 18세 이상만 참여할 수 있어요.", { ageConfirmed: "만 18세 이상만 참여할 수 있어요." });
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

const PHOTO_CACHE_S = 86400;

export const publicGuideViewRoutes = new Hono<AppEnv>()
  // 브랜드가 올린 제품 사진 (AIWITH-368). 경로에 추측할 수 없는 id 가 들어 있어 공개로 둔다
  .get("/guide-photo/:path{guide-photos/.+}", async (c) => {
    const obj = await c.env.FILES.get(c.req.param("path"));
    if (!obj) return c.notFound();
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": `public, max-age=${PHOTO_CACHE_S}` } });
  })
  // 인플루언서별 가이드 또는 가이드 공용 링크(slug)
  .get("/guide/:token", async (c) => {
    const db = c.var.db;
    const token = c.req.param("token");
    const row = await byToken(db, "guideToken", token);
    if (!row) {
      const guide = await publishedBySlug(db, token);
      if (!guide) throw linkNotFound();
      return c.json({ mode: "shared", lang: guide.lang, guide: await publicGuideBody(db, guide, await brandNameOf(db, guide.workspaceId, guide.id)), turnstile: await publicJoinChallenge(c.env, guide.id) });
    }
    const { gi, guide, influencer, brandName } = row;
    const q = c.req.query("lang");
    await recordView(db, row, q === "ko" || q === "en" ? q : influencer.lang);
    const consent = await currentConsent(db, gi.id);
    return c.json({
      mode: "personal",
      lang: influencer.lang,
      influencer: { displayName: influencer.displayName, email: influencer.email, country: influencer.country },
      guide: await publicGuideBody(db, guide, brandName),
      consent: consent ? { agreedAt: consent.agreedAt, docVersion: consent.docVersion } : null,
      tabs: await influencerTabs(db, gi, guide),
      leadLinks: await influencerLeadLinks(db, c.env.PUBLIC_SHORT_BASE, guide.id, influencer.id),
      consentDocVersion: CONSENT_DOC_VERSION,
      instagram: await publicGuideInstagram(db, c.env, gi.id, q === "ko" || q === "en" ? q : influencer.lang, gi.guideToken),
    });
  })
  // 공용 링크로 들어온 인플루언서가 이름·계정을 넣으면 본인 링크를 만든다
  .post("/guide/:slug/join", async (c) => c.json(await joinPublicGuide(c, c.req.param("slug")), 201))
  .post("/guide/:token/consent", async (c) => {
    const body = parse(consentBody, await c.req.json());
    const db = c.var.db;
    const row = await requireByToken(db, "guideToken", c.req.param("token"));
    const { gi, guide, influencer } = row;
    validateConsent(body);
    if (await currentConsent(db, gi.id)) throw new ApiError(409, "already_consented", "이미 동의를 완료했어요.");
    const agreedAt = await saveConsent(db, row, body, c.req.header("cf-connecting-ip") ?? null);
    await logEvents(db, guide.workspaceId, [
      ["participation_accepted", { guide_id: guide.id, gi_id: gi.id }],
      ["consent_submitted", { version: CONSENT_DOC_VERSION, country: body.country, optional_items: body.items.secondary_use === true ? ["secondary_use"] : [] }],
    ]);
    c.executionCtx.waitUntil(notifyOwners(c.env, db, guide.workspaceId, `[${guide.name}] ${influencer.displayName}님이 참여에 동의했어요`, `${influencer.displayName}님이 가이드 "${guide.name}" 참여에 동의했어요. 이제 영상을 올릴 수 있어요.`));
    return c.json({ tabs: await influencerTabs(db, gi, guide), agreedAt }, 201);
  })
  .post("/guide/:token/withdraw", async (c) => {
    const db = c.var.db;
    const { gi, guide, influencer } = await requireByToken(db, "guideToken", c.req.param("token"));
    const consent = await currentConsent(db, gi.id);
    if (!consent) throw new ApiError(400, "no_consent", "철회할 동의가 없어요.");
    if (!(await withdrawMedia(db, gi.id, consent.id, now()))) throw new ApiError(409, "consent_changed", "동의 상태가 바뀌었어요. 화면을 다시 열어 확인해 주세요.");
    await logEvent(db, guide.workspaceId, "consent_withdrawn", { guide_id: guide.id, gi_id: gi.id });
    // 대기·진행 중인 처리 작업은 멈추고 위에서 예약한 제출물별 파기는 재동의와 관계없이 완료한다.
    await cancelProcessingFor(db, gi.id, consent.id);
    c.executionCtx.waitUntil(notifyOwners(c.env, db, guide.workspaceId, `[${guide.name}] ${influencer.displayName}님이 동의를 철회했어요`, `${influencer.displayName}님이 가이드 "${guide.name}" 동의를 철회했어요. 처리 중인 작업은 멈추고 원본·프레임·전사는 삭제 예정이에요. 이미 내려받은 파일은 브랜드가 관리해야 해요.`));
    return c.json({ ok: true });
  });
