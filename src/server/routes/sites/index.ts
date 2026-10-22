import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { sites } from "../../db/schema";
import { parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { dailyRows, newSiteKey, ownSite, siteFields, summaries, toClient } from "./shared";

// /api/sites: 웹 SDK 사이트 등록·설치 스니펫·최근 7일 요약 (docs/14 11-1 8)

const createBody = z.object({
  name: siteFields.name,
  domains: siteFields.domains,
  consentMode: siteFields.consentMode.default("auto"),
  collectRawEmail: siteFields.collectRawEmail.default(false),
  currency: siteFields.currency.default("KRW"),
  attributionDays: siteFields.attributionDays.default(30),
});
const patchBody = z.object(siteFields).partial();

export const siteRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const rows = await db.select().from(sites).where(and(eq(sites.workspaceId, workspace.id), isNull(sites.deletedAt))).orderBy(desc(sites.createdAt));
    const sums = await summaries(db, rows.map((s) => s.id));
    return c.json({ sites: rows.map((s) => toClient(s, c.env.APP_URL, sums.get(s.id)!)) });
  })
  .post("/", editorsOnly, async (c) => {
    const body = parse(createBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const { domains, ...rest } = body;
    const row = { id: newId(), workspaceId: workspace.id, siteKey: newSiteKey(), allowedDomains: domains, ...rest, createdAt: now() };
    await db.insert(sites).values(row);
    await logEvent(db, workspace.id, "site_created", { site_id: row.id, domain_count: domains.length });
    const site = await ownSite(db, workspace.id, row.id);
    return c.json({ site: toClient(site, c.env.APP_URL, (await summaries(db, [site.id])).get(site.id)!) }, 201);
  })
  .get("/:id", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const site = await ownSite(db, workspace.id, c.req.param("id"));
    const [sums, daily] = await Promise.all([summaries(db, [site.id]), dailyRows(db, site.id)]);
    return c.json({ site: toClient(site, c.env.APP_URL, sums.get(site.id)!), daily });
  })
  .patch("/:id", editorsOnly, async (c) => {
    const body = parse(patchBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const site = await ownSite(db, workspace.id, c.req.param("id"));
    const { domains, ...rest } = body;
    await db.update(sites).set({ ...rest, ...(domains && { allowedDomains: domains }) }).where(eq(sites.id, site.id));
    return c.json({ ok: true });
  })
  // 키 재발급. 예전 키로 오는 수집은 404 로 끊긴다(설치된 스니펫을 바꿔야 한다)
  .post("/:id/rotate-key", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const site = await ownSite(db, workspace.id, c.req.param("id"));
    const siteKey = newSiteKey();
    await db.update(sites).set({ siteKey }).where(eq(sites.id, site.id));
    await logEvent(db, workspace.id, "site_key_rotated", { site_id: site.id });
    return c.json({ siteKey });
  })
  .delete("/:id", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const site = await ownSite(c.var.db, workspace.id, c.req.param("id"));
    await c.var.db.update(sites).set({ deletedAt: now() }).where(eq(sites.id, site.id));
    return c.json({ ok: true });
  });
