import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { workspaceCounts } from "../../lib/guide-status";
import { workspaceCtx } from "../../middleware/auth";
import { guideCrudRoutes } from "./guides";
import { guideInfluencerRoutes } from "./guide-influencers";

export { guidelineRoutes } from "./rules";
export { influencerRoutes } from "./influencers";

// /api/guides 아래: 가이드 CRUD·초안·발행 + 인플루언서 탭
export const guideRoutes = new Hono<AppEnv>().route("/", guideCrudRoutes).route("/", guideInfluencerRoutes);

// 홈 (US-02 시작 체크리스트 + 지표 카드)
export const homeRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const { workspace } = workspaceCtx(c);
  return c.json(await workspaceCounts(c.var.db, workspace.id));
});
