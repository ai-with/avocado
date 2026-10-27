import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { ApiError } from "../../lib/errors";
import { newId } from "../../lib/ids";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { checkGuidePhoto, PHOTO_PROBLEM_MESSAGE, type PhotoProblem } from "../../../shared/guide-public";

// 가이드 제품 사진 업로드 (AIWITH-368). 본문 = 이미지 바이트, 저장 경로는 워크스페이스별로 나눈다
export const GUIDE_PHOTO_PREFIX = "guide-photos";
export const guidePhotoUrl = (path: string) => `/api/public/guide-photo/${path}`;

const problemError = (problem: PhotoProblem) =>
  new ApiError(problem === "too_large" ? 413 : 400, `photo_${problem}`, PHOTO_PROBLEM_MESSAGE[problem], { photo: PHOTO_PROBLEM_MESSAGE[problem] });

export const guidePhotoRoutes = new Hono<AppEnv>().post("/photos", editorsOnly, async (c) => {
  const { workspace } = workspaceCtx(c);
  const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
  // 바이트를 읽기 전에 선언한 크기로 먼저 거른다. 길이 머리글이 없으면 읽은 뒤 다시 본다
  const early = checkGuidePhoto(type, Number(c.req.header("content-length") ?? 1));
  if (early) throw problemError(early);
  const buf = await c.req.arrayBuffer();
  const problem = checkGuidePhoto(type, buf.byteLength);
  if (problem) throw problemError(problem);
  const path = `${GUIDE_PHOTO_PREFIX}/${workspace.id}/${newId()}`;
  await c.env.FILES.put(path, buf, { httpMetadata: { contentType: type } });
  return c.json({ path, url: guidePhotoUrl(path) }, 201);
});
