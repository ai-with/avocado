import { SCENE_TITLES, type Scene, type SceneKey } from "./guides";

// 가이드 공개 화면·편집 화면이 함께 쓰는 규칙: 제품 사진 검증, 장면 기본 제목, 링크 언어 (AIWITH-368·369·373)

export type GuideLang = "ko" | "en";

export const GUIDE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const GUIDE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const GUIDE_PHOTO_ACCEPT = GUIDE_PHOTO_TYPES.join(",");

export type PhotoProblem = "bad_type" | "too_large" | "empty";
export const PHOTO_PROBLEM_MESSAGE: Record<PhotoProblem, string> = {
  bad_type: "JPG, PNG, WEBP 이미지만 올릴 수 있어요.",
  too_large: "이미지는 5MB 이하로 올려 주세요.",
  empty: "빈 파일은 올릴 수 없어요.",
};

// 서버와 브라우저가 같은 기준으로 막는다. 문제가 없으면 null
export function checkGuidePhoto(type: string, size: number): PhotoProblem | null {
  if (!(GUIDE_PHOTO_TYPES as readonly string[]).includes(type)) return "bad_type";
  if (size <= 0) return "empty";
  if (size > GUIDE_PHOTO_MAX_BYTES) return "too_large";
  return null;
}

// AI 초안·빈 템플릿이 넣은 기본 제목이면 장면 키를, 브랜드가 쓴 제목이면 null 을 돌려준다
export function defaultSceneKey(scene: Pick<Scene, "key" | "title">): SceneKey | null {
  const title = scene.title.trim();
  if (title === SCENE_TITLES[scene.key] || title.toLowerCase() === scene.key) return scene.key;
  return null;
}

export const isGuideLang = (v: string | null | undefined): v is GuideLang => v === "ko" || v === "en";

// 공개 가이드 URL 에 화면 언어를 붙인다. 이미 있으면 바꾼다
export function withLangParam(url: string, lang: GuideLang): string {
  const [base, hash = ""] = url.split("#");
  const [path, query = ""] = base!.split("?");
  const params = new URLSearchParams(query);
  params.set("lang", lang);
  return `${path}?${params.toString()}${hash ? `#${hash}` : ""}`;
}

// 주소의 ?lang= 값. 없거나 지원하지 않는 값이면 null
export function langFromSearch(search: string): GuideLang | null {
  const v = new URLSearchParams(search).get("lang");
  return isGuideLang(v) ? v : null;
}
