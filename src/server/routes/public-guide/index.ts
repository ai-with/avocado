import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { publicGuideViewRoutes } from "./guide";
import { uploadRoutes } from "./upload";
import { mediaRoutes } from "./media";

export { abortStaleUploads } from "./cleanup";

// 인플루언서용 공개 API (/api/public). 로그인 없이 토큰으로만 접근한다 (4-1)
export const publicGuideRoutes = new Hono<AppEnv>().route("/", publicGuideViewRoutes).route("/", uploadRoutes).route("/", mediaRoutes);
