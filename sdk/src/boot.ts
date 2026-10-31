import type { ConsentState } from "../../src/shared/sdk-events";
import type { ConversionInput, IdentifyInput } from "./commands";
import { applyInit, KEY_OPT_OUT, parseConsent, readScriptConfig, type InitOptions, type SdkConfig } from "./config";
import { AvocadoSdk } from "./sdk";
import { serverConsent } from "./bootstrap-config";
import { canPersist, canSend, initialConsent, privacyDenied, type ConsentPolicy } from "./consent";
import { safeLocalStorage, SdkStorage } from "./storage";

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

/** Evaluate preload commands in their original privacy generation, not under
 * the final grant. Only the surviving generation may be replayed after boot. */
function planFromQueue(base: SdkConfig, queued: CommandArgs[]) {
  let config = base;
  let optedOut: boolean;
  try { optedOut = safeLocalStorage()?.getItem(KEY_OPT_OUT) === "1"; } catch { optedOut = true; }
  let policy = initialConsent(config.consent, navigator, optedOut, config.consentMode);
  let explicitConsent = false;
  let clearTracking = policy.state === "denied";
  let dropAttribution = clearTracking;
  let replay: CommandArgs[] = [];
  const transition = (next: ConsentPolicy, force = false) => {
    if (force || next.state !== policy.state || next.requireConsent !== policy.requireConsent) {
      replay = [];
      clearTracking = true;
      if (next.state === "denied" || (policy.state === "granted" && next.state !== "granted")) dropAttribution = true;
    }
    policy = next;
  };
  for (const args of queued) {
    const [command, value] = args;
    if (command === "init" && value && typeof value === "object") {
      const options = value as InitOptions, previousHash = config.hashEmail;
      config = applyInit(config, options);
      const option = parseConsent(options.consent);
      if (option) {
        explicitConsent = true;
        transition(initialConsent(option, navigator, optedOut, config.consentMode), previousHash !== config.hashEmail);
      } else if (previousHash !== config.hashEmail) transition(policy, true);
    } else if (command === "consent") {
      const state = parseConsent(value as string);
      if (state && state !== "require") {
        explicitConsent = true;
        if (state === "granted" && !privacyDenied(navigator)) optedOut = false;
        transition(initialConsent(state, navigator, optedOut, config.consentMode));
      }
    } else if (command === "optOut") {
      explicitConsent = true;
      optedOut = true;
      transition({ ...policy, state: "denied" }, true);
    } else if (command === "reset") {
      replay = [];
      clearTracking = true;
      dropAttribution = true;
    } else if (command === "identify" ? canPersist(policy) : canSend(policy)) {
      replay.push(args);
    }
  }
  const initial: ConsentState | "optOut" | undefined = explicitConsent ? (optedOut ? "optOut" : policy.state) : undefined;
  return { config, initial, replay, clearTracking, dropAttribution };
}

const pending = new WeakMap<Window, Promise<AvocadoSdk | null>>();

/** Resolve policy before constructing anything that can persist or capture events. */
export function boot(win: Window, script: HTMLScriptElement | null): Promise<AvocadoSdk | null> {
  if (win.avocado?.loaded) return Promise.resolve(null);
  const existing = pending.get(win);
  if (existing) return existing;
  const task = bootstrap(win, script).catch(() => null).finally(() => pending.delete(win));
  pending.set(win, task);
  return task;
}

async function bootstrap(win: Window, script: HTMLScriptElement | null): Promise<AvocadoSdk | null> {
  const base = readScriptConfig(script);
  if (!base.site) return null;
  // Preserve commands appended while the policy request is in flight.
  const stub: AvocadoFunction = win.avocado ?? Object.assign((...args: CommandArgs): void => { stub.q?.push(args); }, { q: [] as CommandArgs[] });
  win.avocado = stub;
  const mode = await serverConsent(base);
  if (!mode || win.avocado !== stub || stub.loaded) return null;
  const queued = Array.from(stub.q ?? [], (args) => Array.from(args));
  const { config, initial, replay, clearTracking, dropAttribution } = planFromQueue({ ...base, consentMode: base.consent === "require" ? "require" : mode }, queued);
  // Clear old storage before constructor applyConsent()/restoreOffline() can read it.
  if (clearTracking) new SdkStorage(config.cookieDomain, config.attributionDays).clear();
  const sdk = new AvocadoSdk(config, initial, dropAttribution);
  const api: AvocadoFunction = (...args) => dispatch(sdk, args);
  api.loaded = true;
  win.avocado = api;
  sdk.start();
  for (const args of replay) dispatch(sdk, args);
  return sdk;
}
