import { probeSafely } from "./safe-fetch";
import type { DriveAccess } from "../../shared/guides";

// 드라이브 공유 링크를 로그인 없이 열 수 있는지 서버에서 확인한다 (AIWITH-375).
// 비공개 파일은 accounts.google.com 로그인으로 보내거나 403·404 를 준다
const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);
const LOGIN_HOST = "accounts.google.com";
const BLOCKED_STATUSES = new Set([401, 403, 404]);

const isLoginPage = (url: URL) => url.hostname === LOGIN_HOST;

export function isDriveUrl(raw: string): boolean {
  try {
    return DRIVE_HOSTS.has(new URL(raw).hostname.toLowerCase());
  } catch {
    return false;
  }
}

// status 가 null 이면 로그인 화면에서 멈춘 경우
export function judgeDriveResponse(status: number | null, finalUrl: string): DriveAccess {
  if (isLoginPage(new URL(finalUrl))) return "blocked";
  if (status === null) return "unknown";
  if (BLOCKED_STATUSES.has(status)) return "blocked";
  if (status >= 200 && status < 300) return "accessible";
  return "unknown";
}

// 드라이브가 아닌 링크나 네트워크 오류는 unknown. 판정 실패로 제출을 막지 않는다
export async function checkDriveAccess(url: string): Promise<DriveAccess> {
  if (!isDriveUrl(url)) return "unknown";
  try {
    const { status, finalUrl } = await probeSafely(url, isLoginPage);
    return judgeDriveResponse(status, finalUrl);
  } catch {
    return "unknown";
  }
}
