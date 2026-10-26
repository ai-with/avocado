import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { linkChannels, shortLinks } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { getGuide } from "../../lib/guides";
import { createShortLinks, ensureChannels } from "../../lib/links";
import { createContentLink } from "../../lib/link-content";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { destinationSchema, listLinks, ownLink, resolveDestination } from "./shared";

// 단축링크 목록·만들기·고치기, 채널, 미리보기 이미지

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const utmSchema = z.object({ source: z.string().max(100), medium: z.string().max(100), campaign: z.string().max(100), content: z.string().max(100), term: z.string().max(100) });
const ogSchema = z.object({ title: z.string().max(100).optional(), description: z.string().max(200).optional(), imageKey: z.string().max(200).optional() });
const createBody = z.object({ destination: destinationSchema, guideId: z.string().nullable().optional(), channelKey: z.string().default("ig_bio") });
const contentLabelSchema = z.string().trim().min(1, "콘텐츠 이름을 넣어 주세요.").max(50);
const patchBody = z.object({ utm: utmSchema.optional(), og: ogSchema.optional(), destination: destinationSchema.optional(), contentLabel: contentLabelSchema.optional() });

export const linkCrudRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const [channels, links] = await Promise.all([ensureChannels(db, workspace.id), listLinks(db, c.env, workspace.id, c.req.query("guideId") || undefined)]);
    return c.json({ channels, links });
  })
  // 단일 공용 링크 (자료·폼 화면에서 바로 만들 때)
  .post("/", editorsOnly, async (c) => {
    const body = parse(createBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const guide = body.guideId ? await getGuide(db, workspace.id, body.guideId) : null;
    const destination = await resolveDestination(db, workspace.id, body.destination);
    await ensureChannels(db, workspace.id);
    const target = { influencerId: null, handle: null };
    const result = await createShortLinks(db, { workspaceId: workspace.id, guideId: guide?.id ?? null, guideSlug: guide?.slug ?? "shared", targets: [target], channelKeys: [body.channelKey], destination });
    await logEvent(db, workspace.id, "short_link_created", { count: result.created, channel_count: 1 });
    return c.json(result, 201);
  })
  .patch("/:id", editorsOnly, async (c) => {
    const body = parse(patchBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const link = await ownLink(db, workspace.id, c.req.param("id"));
    if (body.contentLabel && !link.contentKey) throw new ApiError(400, "not_content_link", "기본 링크에는 콘텐츠 이름을 붙일 수 없어요.");
    const dest = body.destination ? await resolveDestination(db, workspace.id, body.destination) : null;
    await db
      .update(shortLinks)
      .set({
        ...(body.utm && { utm: body.utm }),
        ...(body.og && { og: body.og }),
        ...(body.contentLabel && { contentLabel: body.contentLabel }),
        ...(dest && { destinationType: dest.type, destinationId: dest.id, destinationUrl: dest.url }),
      })
      .where(eq(shortLinks.id, link.id));
    return c.json({ ok: true });
  })
  // 콘텐츠별 링크 추가: 기본 링크(:id) 칸에 utm_content 만 다른 링크를 하나 더 만든다
  .post("/:id/contents", editorsOnly, async (c) => {
    const { label } = parse(z.object({ label: contentLabelSchema }), await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const base = await ownLink(db, workspace.id, c.req.param("id"));
    if (base.contentKey) throw new ApiError(400, "not_base_link", "기본 링크에서만 콘텐츠별 링크를 추가할 수 있어요.");
    const link = await createContentLink(db, base, label);
    await logEvent(db, workspace.id, "short_link_created", { count: 1, channel_count: 1, guide_id: base.guideId, content: true });
    return c.json({ link: { id: link.id, slug: link.slug, contentKey: link.contentKey, contentLabel: link.contentLabel, utm: link.utm } }, 201);
  })
  // 링크 삭제(콘텐츠 링크 포함). 클릭 기록은 남는다. 이후 /l/:slug 는 만료 안내를 보여 준다
  .delete("/:id", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const link = await ownLink(c.var.db, workspace.id, c.req.param("id"));
    await c.var.db.update(shortLinks).set({ deletedAt: now() }).where(eq(shortLinks.id, link.id));
    return c.json({ ok: true });
  })
  .post("/:id/qr", async (c) => {
    const { workspace } = workspaceCtx(c);
    const link = await ownLink(c.var.db, workspace.id, c.req.param("id"));
    await logEvent(c.var.db, workspace.id, "link_qr_downloaded", { link_id: link.id });
    return c.json({ ok: true });
  })
  .get("/channels", async (c) => {
    const { workspace } = workspaceCtx(c);
    return c.json({ channels: await ensureChannels(c.var.db, workspace.id) });
  })
  .post("/channels", editorsOnly, async (c) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1, "채널 이름을 넣어 주세요.").max(30) }), await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const channels = await ensureChannels(db, workspace.id);
    const row = { id: newId(), workspaceId: workspace.id, key: `custom:${newId().slice(0, 8)}`, name, sort: channels.length, createdAt: now() };
    await db.insert(linkChannels).values(row);
    await logEvent(db, workspace.id, "channel_added", { channel: row.key });
    return c.json({ channel: row }, 201);
  })
  // 이름만 바꾼다. 키(채널 ID)는 이전 클릭과 섞이지 않게 고정
  .patch("/channels/:id", editorsOnly, async (c) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(30) }), await c.req.json());
    const { workspace } = workspaceCtx(c);
    await c.var.db.update(linkChannels).set({ name }).where(and(eq(linkChannels.id, c.req.param("id")), eq(linkChannels.workspaceId, workspace.id)));
    return c.json({ ok: true });
  })
  // 미리보기 카드 이미지, 폼 헤더 이미지 업로드 (본문 = 이미지 바이트)
  .post("/assets", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const type = c.req.header("content-type") ?? "";
    if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new ApiError(400, "invalid_image", "PNG, JPG, WEBP, GIF 이미지만 올릴 수 있어요.");
    const buf = await c.req.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) throw new ApiError(413, "image_too_large", "이미지는 5MB 이하로 올려 주세요.");
    const key = `lead-assets/${workspace.id}/${newId()}`;
    await c.env.FILES.put(key, buf, { httpMetadata: { contentType: type } });
    return c.json({ key, url: `/api/public/asset/${key}` }, 201);
  });
