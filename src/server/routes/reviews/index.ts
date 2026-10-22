import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { reviewListRoutes } from "./list";
import { candidateRoutes } from "./candidates";
import { feedbackRoutes } from "./feedback";
import { roundRoutes } from "./rounds";

export { fileRoutes, guideContentRoutes } from "./files";
export { publicFeedbackRoutes } from "./public-feedback";
export { sentRoundCount } from "./shared";

// F-60~F-62 검수 화면 API (/api/reviews)
export const reviewRoutes = new Hono<AppEnv>().route("/", reviewListRoutes).route("/", candidateRoutes).route("/", feedbackRoutes).route("/", roundRoutes);
