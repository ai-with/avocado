import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { leadCrudRoutes } from "./leads";
import { tagRoutes } from "./tags";
import { groupRoutes } from "./groups";
import { leadImportRoutes } from "./import";

// /api/leads. 고정 경로(/tags, /groups, /export)가 /:id 보다 먼저 등록되어야 한다
export const leadRoutes = new Hono<AppEnv>().route("/", leadImportRoutes).route("/", tagRoutes).route("/", groupRoutes).route("/", leadCrudRoutes);
