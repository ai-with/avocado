import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { accountRoutes } from "./account";
import { phoneRoutes } from "./phone";
import { passwordRoutes } from "./password";
import { googleRoutes } from "./google";

// /api/auth: 가입·로그인, 휴대폰 인증, 비밀번호 재설정, 구글 로그인
export const authRoutes = new Hono<AppEnv>().route("/", accountRoutes).route("/", phoneRoutes).route("/", passwordRoutes).route("/", googleRoutes);
