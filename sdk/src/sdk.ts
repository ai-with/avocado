import type { AttributionTouch, ConsentState, Envelope, SdkEvent, StoredAttribution } from "../../src/shared/sdk-events";
import { cleanEventUrl, MEMBER_PARAM, parseTouch, saveTouch, stripTrackingParams } from "./attribution";
import { installClickCapture } from "./capture/click";
import { DwellTimer } from "./capture/dwell";
import { installFormCapture } from "./capture/form";
import { installRouteWatcher } from "./capture/pageview";
import { installScrollCapture, type ScrollTracker } from "./capture/scroll";
import { conversionEvent, identifyEvent, trackEvent, type ConversionInput, type IdentifyInput } from "./commands";
import { KEY_MEMBER, KEY_OPT_OUT, SDK_VERSION, type SdkConfig } from "./config";
import { canPersist, canSend, initialConsent, privacyDenied, type ConsentPolicy } from "./consent";
import { randomId, touchIdentity, type Identity } from "./ids";
import { safeLocalStorage, SdkStorage } from "./storage";
import { Transport } from "./transport";
import type { EventInput, Uninstall } from "./types";

const SCHEMA_VERSION = 1;

function readFlag(key: string): boolean {
  return safeLocalStorage()?.getItem(key) === "1";
}

function writeFlag(key: string, on: boolean): void {
  try {
    if (on) safeLocalStorage()?.setItem(key, "1");
    else safeLocalStorage()?.removeItem(key);
  } catch {
    // 저장 불가 브라우저: 이번 페이지에서만 적용된다
  }
}

function cleanReferrer(referrer: string): string | null {
  try {
    return referrer ? cleanEventUrl(referrer) : null;
  } catch {
    return null;
  }
}

/** 브랜드 구성원이 ?avc_optout=1 을 한 번 열면 이 브라우저를 구성원으로 표시한다 (docs/14 6-2 6b) */
function detectMember(url: URL): boolean {
  return url.searchParams.get(MEMBER_PARAM) === "1" || readFlag(KEY_MEMBER);
}

export class AvocadoSdk {
  private policy: ConsentPolicy;
  private readonly storage: SdkStorage;
  private readonly transport: Transport;
  private readonly dwell = new DwellTimer(Date.now(), document.visibilityState === "visible");
  private readonly member: boolean;
  private pageTouch: AttributionTouch | null;
  private generation = 0;
  private destroyed = false;
  private attribution: StoredAttribution | null = null;
  private identity: Identity | null = null;
  private referrer: string | null;
  private lastUrl: string;
  private scroll: ScrollTracker | null = null;
  private uninstallers: Uninstall[] = [];

  constructor(private readonly config: SdkConfig, initialCommand?: ConsentState | "optOut", discardAttribution = false) {
    const url = new URL(location.href);
    this.storage = new SdkStorage(config.cookieDomain, config.attributionDays);
    this.member = detectMember(url);
    this.referrer = cleanReferrer(document.referrer);
    this.pageTouch = discardAttribution ? null : parseTouch(url, document.referrer, Date.now());
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (initialCommand === "optOut") writeFlag(KEY_OPT_OUT, true);
    if (initialCommand === "granted" && !privacyDenied(nav)) writeFlag(KEY_OPT_OUT, false);
    this.policy = initialConsent(initialCommand === "optOut" ? "denied" : initialCommand ?? config.consent, nav, readFlag(KEY_OPT_OUT), config.consentMode);
    this.transport = new Transport({
      endpoint: `${config.api}/collect`,
      storage: this.storage,
      buildEnvelope: (events) => this.envelope(events),
      canPersist: () => !this.destroyed && canPersist(this.policy) && !privacyDenied(navigator),
      canSend: () => !this.destroyed && canSend(this.policy) && !privacyDenied(navigator),
    });
    this.applyConsent();
    const stripped = stripTrackingParams(location.href);
    if (stripped) history.replaceState(history.state, "", stripped);
    this.lastUrl = cleanEventUrl(location.href);
  }

  /** 수집 리스너를 붙이고 첫 페이지뷰를 바로 보낸다 */
  start(): void {
    if (this.destroyed || this.uninstallers.length) return;
    const emit = (event: EventInput): void => this.emit(event);
    this.scroll = installScrollCapture(this.config.scrollThresholds, emit);
    this.uninstallers = [
      this.scroll.uninstall,
      installClickCapture({ autocapture: this.config.autocapture, emit }),
      installRouteWatcher(() => this.onRouteChange()),
      this.listenVisibility(),
    ];
    if (this.config.autocapture) this.uninstallers.push(installFormCapture(emit));
    this.page(true);
  }

  destroy(): void {
    this.destroyed = true;
    this.generation++;
    for (const uninstall of this.uninstallers) uninstall();
    this.uninstallers = [];
    this.transport.clear();
  }

  page(immediate = false): void {
    this.emit({ t: "pageview", title: document.title }, immediate);
    // SPA 라우터가 스크롤 위치·본문을 바꾼 뒤에 재도록 바로 재지 않는다
    this.scroll?.schedule();
  }

  track(name: unknown, props?: unknown): void {
    const event = trackEvent(name, props);
    if (event) this.emit(event);
  }

  conversion(input?: ConversionInput): void {
    this.emit(conversionEvent(input), true);
  }

  /** 사람 연결은 granted에서만 (docs/14 7장 동의 전 모드) */
  async identify(input?: IdentifyInput): Promise<void> {
    if (this.destroyed || !canPersist(this.policy) || privacyDenied(navigator)) return;
    const generation = this.generation;
    const event = await identifyEvent(input, this.config.hashEmail);
    if (event && generation === this.generation && canPersist(this.policy)) this.emit(event, true);
  }

  consent(state: ConsentState): void {
    if (state !== "granted" && state !== "denied" && state !== "pending") return;
    if (this.destroyed) return;
    if (privacyDenied(navigator) || (state !== "granted" && readFlag(KEY_OPT_OUT))) state = "denied";
    if (state === "granted") writeFlag(KEY_OPT_OUT, false);
    if (state !== this.policy.state) {
      this.generation++;
      this.transport.clear();
      if (state !== "granted") {
        this.storage.clear();
        this.identity = null;
        this.attribution = null;
        this.pageTouch = null;
      }
    }
    this.policy = { ...this.policy, state };
    this.applyConsent();
  }

  /** 이 브라우저에서 수집을 끈다. consent('granted')를 다시 부르기 전까지 유지 */
  optOut(): void {
    writeFlag(KEY_OPT_OUT, true);
    this.consent("denied");
  }

  reset(): void {
    if (this.destroyed) return;
    this.generation++;
    this.transport.clear();
    this.storage.clear();
    this.identity = null;
    this.attribution = null;
    this.pageTouch = null;
  }

  private applyConsent(): void {
    this.storage.setPersistent(canPersist(this.policy));
    if (this.policy.state === "denied") {
      this.transport.clear();
      this.storage.clear();
      this.identity = null;
      this.attribution = null;
      this.pageTouch = null;
      return;
    }
    this.attribution = saveTouch(this.storage, this.pageTouch, Date.now(), this.config.attributionDays);
    if (canPersist(this.policy)) {
      if (this.member) writeFlag(KEY_MEMBER, true);
      this.transport.restoreOffline();
    }
  }

  /** url은 기본으로 지금 주소. SPA 이동 직후 이전 페이지 체류처럼 지난 주소로 남길 때만 넘긴다 */
  private emit(input: EventInput, immediate = false, url = cleanEventUrl(location.href)): void {
    if (this.destroyed) return;
    if (privacyDenied(navigator)) { this.consent("denied"); return; }
    if (!canSend(this.policy)) return;
    const now = Date.now();
    this.identity = touchIdentity(this.storage, this.config.sampleRate, now);
    if (!this.identity.sampled) return;
    const event = { ...input, id: randomId(), ts: now, url, ref: this.referrer } as SdkEvent;
    this.transport.enqueue(event, immediate);
  }

  private envelope(events: SdkEvent[]): Envelope {
    const identity = this.identity ?? touchIdentity(this.storage, this.config.sampleRate, Date.now());
    const envelope: Envelope = {
      v: SCHEMA_VERSION,
      sdk: SDK_VERSION,
      site: this.config.site,
      anon: identity.anon,
      sess: identity.session,
      consent: this.policy.state,
      attr: { first: this.attribution?.first ?? null, last: this.attribution?.last ?? null },
      screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio || 1 },
      sentAt: Date.now(),
      events,
    };
    if (navigator.webdriver) envelope.bot = true;
    if (this.member) envelope.member = true;
    return envelope;
  }

  /** 이전 페이지의 체류 시간을 먼저 보내고, 스크롤 도달 기록을 비운 뒤 페이지뷰 */
  private onRouteChange(): void {
    this.emitDwell(this.lastUrl);
    this.referrer = this.lastUrl;
    this.lastUrl = cleanEventUrl(location.href);
    this.scroll?.reset();
    this.page();
  }

  private emitDwell(url?: string): void {
    const ms = this.dwell.take(Date.now());
    if (ms > 0) this.emit({ t: "dwell", ms }, false, url);
  }

  private listenVisibility(): Uninstall {
    const onChange = (): void => {
      const visible = document.visibilityState === "visible";
      this.dwell.onVisibilityChange(Date.now(), visible);
      if (visible) return;
      this.emitDwell();
      this.transport.flushBeacon();
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }
}
