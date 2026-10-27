import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { DriveAccess } from "../../../shared/guides";
import { PUBLIC_OPTS } from "./guideTypes";

// 입력을 멈추고 잠깐 뒤에 확인한다. 글자마다 서버를 부르지 않게
const DEBOUNCE_MS = 600;
const LOOKS_LIKE_URL = /^https:\/\/[^\s/]+\.[^\s]+/;

export type DriveCheck = DriveAccess | "checking" | null;

// 드라이브 링크를 로그인 없이 열 수 있는지 입력 중에 서버에서 확인한다 (AIWITH-375)
export function useDriveCheck(token: string, url: string): DriveCheck {
  const [access, setAccess] = useState<DriveCheck>(null);
  useEffect(() => {
    if (!LOOKS_LIKE_URL.test(url.trim())) {
      setAccess(null);
      return;
    }
    let alive = true;
    setAccess("checking");
    const timer = setTimeout(() => {
      api
        .post<{ access: DriveAccess }>(`/public/upload/${token}/drive-check`, { url: url.trim() }, PUBLIC_OPTS)
        .then((r) => alive && setAccess(r.access))
        .catch(() => alive && setAccess(null));
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [token, url]);
  return access;
}
