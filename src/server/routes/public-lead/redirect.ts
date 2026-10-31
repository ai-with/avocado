import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { linkClicks, shortLinks } from "../../db/schema";
import { newId, newToken, now, sha256Hex } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { escapeHtml } from "../../lib/html";
import { appendUtm, deviceOf, isBotUA } from "../../lib/links";
import { loadSession } from "../../middleware/auth";
import { appendClickId } from "../../lib/collect/origin";
import { workspaceSiteDomains } from "../../lib/collect/sites";
import { clickDestinationSnapshot } from "../../lib/doc-attribution";
import { NOINDEX, htmlPage, isMember, visitorId } from "./shared";

type Link = typeof shortLinks.$inferSelect;
const REFERRER_MAX = 500;
// 16자 클릭 ID(avc). 내부 PK 대신 밖으로 내보낸다
const CLICK_TOKEN_BYTES = 12;

async function recordClick(c: Context<AppEnv>, link: Link) {
  const ua = c.req.header("user-agent");
  const bot = isBotUA(ua);
  const member = await isMember(c, link.workspaceId);
  const ip = c.req.header("cf-connecting-ip");
  const clickToken = bot ? null : newToken(CLICK_TOKEN_BYTES);
  await c.var.db.insert(linkClicks).values({
    id: newId(),
    linkId: link.id,
    at: now(),
    referrer: c.req.header("referer")?.slice(0, REFERRER_MAX) ?? null,
    device: deviceOf(ua),
    country: (c.req.raw.cf?.country as string | undefined) ?? null,
    // IP 원문은 저장하지 않는다
    ipHash: ip ? await sha256Hex(`${c.env.TOKEN_ENC_KEY ?? ""}:${ip}`) : null,
    isBot: bot,
    isMember: member,
    sessionId: bot ? null : visitorId(c),
    clickToken,
    ...await clickDestinationSnapshot(c.var.db, link),
  });
  await logEvent(c.var.db, link.workspaceId, "short_link_clicked", { link_id: link.id, channel: link.channelKey, is_bot: bot, is_member: member });
  return { bot, clickToken };
}

const destinationOf = (link: Link, appUrl: string) =>
  link.destinationType === "document" ? `/d/${link.slug}` : link.destinationType === "form" ? `/form/${link.slug}` : appendUtm(link.destinationUrl ?? appUrl, link.utm);

// 미리보기 크롤러에 돌려줄 카드(OG) 페이지
function ogPage(link: Link, dest: string, appUrl: string) {
  const abs = new URL(dest, appUrl).toString();
  const image = link.og.imageKey ? `${appUrl}/api/public/asset/${link.og.imageKey}` : "";
  const head = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${escapeHtml(abs)}">`,
    link.og.title && `<meta property="og:title" content="${escapeHtml(link.og.title)}">`,
    link.og.description && `<meta property="og:description" content="${escapeHtml(link.og.description)}">`,
    image && `<meta property="og:image" content="${escapeHtml(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ]
    .filter(Boolean)
    .join("");
  return htmlPage(link.og.title ?? "", `<a href="${escapeHtml(abs)}">${escapeHtml(link.og.title ?? abs)}</a>`, head);
}

// /l/:slug  Worker 최상위 단축링크. 클릭 기록 후 302
export const shortLinkRedirect = new Hono<AppEnv>().get("/:slug", loadSession, async (c) => {
  const link = await c.var.db.select().from(shortLinks).where(eq(shortLinks.slug, c.req.param("slug"))).get();
  if (!link) return c.html(htmlPage("링크를 찾을 수 없어요", "<h2>링크를 찾을 수 없어요</h2><p>주소를 다시 확인해 주세요.</p>"), 404, NOINDEX);
  if (link.deletedAt) return c.html(htmlPage("만료된 링크예요", "<h2>만료된 링크예요</h2><p>링크를 보낸 분께 새 링크를 요청해 주세요.</p>"), 410, NOINDEX);
  const { bot, clickToken } = await recordClick(c, link);
  let dest = destinationOf(link, c.env.APP_URL);
  if (link.destinationType === "url" && clickToken) dest = appendClickId(dest, clickToken, await workspaceSiteDomains(c.var.db, link.workspaceId));
  if (link.destinationType !== "url" && clickToken) dest += `?avc=${encodeURIComponent(clickToken)}`;
  if (bot && (link.og.title || link.og.description || link.og.imageKey)) return c.html(ogPage(link, dest, c.env.APP_URL), 200, NOINDEX);
  return c.redirect(dest, 302);
});
