import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { parse } from "../lib/errors";
import { requireAuthCtx, workspaceCtx } from "../middleware/auth";
import { disconnectSheets, finishSheetsConnect, requireSheetsCsrf, sheetsConfigured, sheetsConnection, sheetsCsrf, startSheetsConnect } from "../lib/google-sheets-auth";
import { getSheetsExport, SHEETS_MAX_ROWS, startSheetsExport } from "../lib/google-sheets-export";
import { validSheetsScope } from "../lib/google-sheets-provider";

const connectBody = z.object({ returnTo: z.string().max(2000).default("/dashboard/performance") });
const exportBody = z.object({ requestId: z.uuid(), connectionGeneration: z.string().min(1).max(200), kind: z.enum(["leads", "performance"]), filters: z.record(z.string().max(100), z.string().max(2000)).default({}) }).strict();

// 앱 자체가 받은 내보내기 전용 추가 동의만 사용한다. 일반 로그인 OAuth와 분리한다.
export const googleSheetsRoutes = new Hono<AppEnv>()
  .get("/status", async (c) => {
    const auth = workspaceCtx(c);
    const connection = await sheetsConnection(c.var.db, auth.user.id);
    const configured = sheetsConfigured(c.env);
    const connected = configured && Boolean(connection?.accessEnc && connection.revokedAt === null && validSheetsScope(connection.scope) && ((connection.expiresAt ?? 0) > Date.now() || connection.refreshEnc));
    return c.json({ configured, connected, generation: connected ? connection!.generation : null, csrfToken: await sheetsCsrf(c.env, auth), maxRows: SHEETS_MAX_ROWS, ...(connected && connection?.accountEmail && { accountEmail: connection.accountEmail }) });
  })
  .post("/connect", async (c) => {
    const auth = workspaceCtx(c);
    await requireSheetsCsrf(c.env, auth, c.req.header("Origin"), c.req.header("X-CSRF-Token"));
    const body = parse(connectBody, await c.req.json());
    return c.json({ authorizationUrl: await startSheetsConnect(c.env, c.var.db, auth, body.returnTo) });
  })
  .get("/callback", async (c) => {
    if (!c.var.auth) return c.redirect("/login?next=%2Fdashboard%2Fperformance");
    const auth = requireAuthCtx(c);
    const result = await finishSheetsConnect(c.env, c.var.db, auth, c.req.query());
    const target = new URL(result.returnTo, c.env.APP_URL);
    target.searchParams.set("sheets", result.outcome);
    return c.redirect(target.pathname + target.search + target.hash);
  })
  .post("/disconnect", async (c) => {
    const auth = workspaceCtx(c);
    await requireSheetsCsrf(c.env, auth, c.req.header("Origin"), c.req.header("X-CSRF-Token"));
    await disconnectSheets(c.env, c.var.db, auth);
    return c.json({ connected: false });
  })
  .post("/exports", async (c) => {
    const auth = workspaceCtx(c);
    await requireSheetsCsrf(c.env, auth, c.req.header("Origin"), c.req.header("X-CSRF-Token"));
    const result = await startSheetsExport(c.env, c.var.db, auth, auth.workspace.id, parse(exportBody, await c.req.json()));
    return c.json(result);
  })
  .get("/exports/:id", async (c) => {
    const auth = workspaceCtx(c);
    return c.json(await getSheetsExport(c.var.db, auth, auth.workspace.id, c.req.param("id")));
  });
