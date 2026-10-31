import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { workspaceCtx } from "../middleware/auth";
import { ApiError, parse } from "../lib/errors";
import { requireAlertCsrf } from "../lib/site-alert-common";
import { saveSiteAlert, siteAlertStatus } from "../lib/site-alert-settings";

const settings = z.object({ enabled: z.boolean(), metric: z.enum(["pageviews", "conversions"]), ratioPercent: z.number().int().min(0).max(90), minimumAverage: z.number().int().min(1).max(1_000_000), confirmationDays: z.number().int().min(1).max(3) }).strict();
const body = z.object({ settings: settings.optional(), subscribed: z.boolean(), expectedGeneration: z.string().max(100).nullable(), expectedSubscriptionGeneration: z.string().max(100).nullable() }).strict();
export const siteAlertRoutes = new Hono<AppEnv>()
  .get("/:id", async (c) => {
    const auth = workspaceCtx(c);
    try { return c.json(await siteAlertStatus(c.env, auth, auth.workspace.id, c.req.param("id"))); }
    catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(503, "alerts_unavailable", "알림 설정을 불러오지 못했어요."); }
  })
  .post("/:id", async (c) => {
    const auth = workspaceCtx(c);
    await requireAlertCsrf(c.env, auth, c.req.header("Origin"), c.req.header("X-CSRF-Token"));
    await saveSiteAlert(c.env, auth, auth.workspace.id, c.req.param("id"), parse(body, await c.req.json()));
    return c.json({ ok: true });
  });
