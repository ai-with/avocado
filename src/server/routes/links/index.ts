import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { linkCrudRoutes } from "./links";
import { linkAnalyticsRoutes } from "./analytics";

export { guideLinkRoutes } from "./guide-links";

// /api/links: 단축링크 관리와 분석
export const linkRoutes = new Hono<AppEnv>().route("/", linkCrudRoutes).route("/", linkAnalyticsRoutes);
