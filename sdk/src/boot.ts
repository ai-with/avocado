import type { ConsentState } from "../../src/shared/sdk-events";
import type { ConversionInput, IdentifyInput } from "./commands";
import { applyInit, parseConsent, readScriptConfig, type InitOptions, type SdkConfig } from "./config";
import { AvocadoSdk } from "./sdk";

type CommandArgs = unknown[];

export interface AvocadoFunction {
  (...args: CommandArgs): void;
  q?: ArrayLike<unknown>[];
  loaded?: boolean;
}

declare global {
  interface Window {
    avocado?: AvocadoFunction;
  }
}

/** 시작 후 명령 분기. init은 시작 전에만 반영되므로 여기서는 무시한다 */
export function dispatch(sdk: AvocadoSdk, [command, first, second]: CommandArgs): void {
  switch (command) {
    case "track":
      return sdk.track(first, second);
    case "conversion":
      return sdk.conversion(first as ConversionInput | undefined);
    case "identify":
      return void sdk.identify(first as IdentifyInput | undefined);
    case "consent":
      return sdk.consent(first as ConsentState);
    case "reset":
      return sdk.reset();
    case "optOut":
      return sdk.optOut();
    case "page":
      return sdk.page();
  }
}

/** 스텁 큐에서 init·consent를 먼저 반영해 첫 페이지뷰부터 그 설정으로 수집한다 */
function configFromQueue(base: SdkConfig, queued: CommandArgs[]): SdkConfig {
  let config = base;
  for (const [command, value] of queued) {
    if (command === "init" && value && typeof value === "object") config = applyInit(config, value as InitOptions);
    if (command === "consent") config = { ...config, consent: parseConsent(value as string) ?? config.consent };
  }
  return config;
}

/** 스텁(window.avocado.q)을 실제 함수로 바꾸고 쌓인 명령을 순서대로 처리한다 (docs/14 8-1) */
export function boot(win: Window, script: HTMLScriptElement | null): AvocadoSdk | null {
  const stub = win.avocado;
  if (stub?.loaded) return null;
  const queued = Array.from(stub?.q ?? [], (args) => Array.from(args));
  const config = configFromQueue(readScriptConfig(script), queued);
  if (!config.site) return null;
  const sdk = new AvocadoSdk(config);
  const api: AvocadoFunction = (...args) => dispatch(sdk, args);
  api.loaded = true;
  win.avocado = api;
  sdk.start();
  for (const args of queued) {
    if (args[0] !== "init" && args[0] !== "consent") dispatch(sdk, args);
  }
  return sdk;
}
