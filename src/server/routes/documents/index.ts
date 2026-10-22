import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { documentCrudRoutes } from "./documents";
import { documentAnalyticsRoutes } from "./analytics";

export { gateSchema } from "./shared";

// /api/documents: 자료 관리와 열람 분석
export const documentRoutes = new Hono<AppEnv>().route("/", documentCrudRoutes).route("/", documentAnalyticsRoutes);
