import { boot } from "./boot";
import { findInstallScript } from "./config";

// 실행 중이 아니면 document.currentScript가 null이 되므로 스크립트 태그는 지금 잡아 둔다
const script = findInstallScript(document);
const IDLE_TIMEOUT_MS = 2_000;
const start = (): void => void boot(window, script);

// 페이지 로드를 막지 않게 유휴 시간에 시작한다 (docs/14 8-4)
if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
else setTimeout(start, 0);
