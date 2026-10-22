import type { ConsentState } from "../../src/shared/sdk-events";
import type { ConsentOption } from "./config";

export interface ConsentPolicy {
  state: ConsentState;
  // 사이트 동의 모드 require: pending 동안 수집 자체를 하지 않는다
  requireConsent: boolean;
}

interface PrivacySignals {
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}

/** DNT·GPC 신호가 있거나 이 브라우저에서 optOut 했으면 denied로 시작한다 (docs/14 7장) */
export function initialConsent(option: ConsentOption | null, signals: PrivacySignals, optedOut: boolean): ConsentPolicy {
  const requireConsent = option === "require";
  if (optedOut || signals.doNotTrack === "1" || signals.globalPrivacyControl === true) {
    return { state: "denied", requireConsent };
  }
  if (requireConsent) return { state: "pending", requireConsent };
  // 기본 auto(국내 사이트): 동의 신호 없으면 granted로 시작 (docs/14 12장 S3)
  return { state: option ?? "granted", requireConsent };
}

/** 전송 가능 여부. pending은 auto 모드에서만 메모리 모드로 보낸다 */
export function canSend(policy: ConsentPolicy): boolean {
  return policy.state === "granted" || (policy.state === "pending" && !policy.requireConsent);
}

/** 디스크 저장과 사람 연결(identify)은 granted에서만 */
export function canPersist(policy: ConsentPolicy): boolean {
  return policy.state === "granted";
}
