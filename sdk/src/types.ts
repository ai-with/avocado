import type { SdkEvent, SdkEventBase } from "../../src/shared/sdk-events";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 수집 모듈이 만드는 이벤트 본문. id·ts·url·ref는 런타임이 붙인다 */
export type EventInput = DistributiveOmit<SdkEvent, keyof SdkEventBase>;

export type Emit = (event: EventInput) => void;

/** 수집 모듈이 붙인 리스너를 떼는 함수 (테스트와 reset용) */
export type Uninstall = () => void;
