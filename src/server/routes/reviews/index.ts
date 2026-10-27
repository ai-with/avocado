import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { reviewListRoutes } from "./list";
import { candidateRoutes } from "./candidates";
import { feedbackRoutes } from "./feedback";
import { roundRoutes } from "./rounds";
import { reviewStatsRoutes } from "./stats";

export { fileRoutes, guideContentRoutes } from "./files";
export { publicFeedbackRoutes } from "./public-feedback";
export { approvalOf, sentRoundCount } from "./shared";

// F-60~F-62 검수 화면 API (/api/reviews). /rule-stats 는 /:id 보다 먼저 등록한다
export const reviewRoutes = new Hono<AppEnv>().route("/", reviewStatsRoutes).route("/", reviewListRoutes).route("/", candidateRoutes).route("/", feedbackRoutes).route("/", roundRoutes);
