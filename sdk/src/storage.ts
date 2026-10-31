import { KEY_ATTR, KEY_ID, KEY_QUEUE, KEY_MEMBER } from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;
// localStorage 값 중 쿠키에도 함께 쓰는 키. 쿠키가 있어야 서브도메인 간(www에서 app으로) 이어진다 (docs/14 4-2)
const COOKIE_NAMES: Record<string, string> = { [KEY_ATTR]: "_avc" };
const PERSISTED_KEYS = [KEY_ATTR, KEY_ID, KEY_QUEUE, KEY_MEMBER];

export function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const found = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  const value = found?.slice(prefix.length);
  return value ? decodeURIComponent(value) : null;
}

function writeCookie(name: string, value: string, maxAgeSeconds: number, domain: string | null): void {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  const domainPart = domain ? `; domain=${domain}` : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax${secure}${domainPart}`;
}

/** 쿠키를 쓸 수 있는 가장 짧은 상위 도메인을 찾는다 (example.co.kr 같은 공용 접미사는 브라우저가 거부한다) */
export function detectCookieDomain(hostname: string): string | null {
  const labels = hostname.split(".");
  for (let size = 2; size <= labels.length; size++) {
    const candidate = labels.slice(-size).join(".");
    writeCookie("_avc_t", "1", 10, candidate);
    if (readCookie("_avc_t")) {
      writeCookie("_avc_t", "", 0, candidate);
      return candidate;
    }
  }
  return null;
}

/**
 * 동의 전(pending)에는 메모리에만 두고, granted가 되면 localStorage(와 일부 쿠키)로 옮긴다.
 * PostHog의 memory 지속성 모드와 같은 방식 (docs/14 7장)
 */
export class SdkStorage {
  private readonly memory = new Map<string, string>();
  private persistent = false;
  private cookieDomain: string | null | undefined;

  constructor(
    private readonly configuredCookieDomain: string | null,
    private readonly cookieDays: number,
  ) {}

  isPersistent(): boolean {
    return this.persistent;
  }

  /**
   * granted가 되면 메모리 값을 디스크로 옮긴다. 디스크에 이미 있는 값(재방문자의 익명 ID 등)은 덮지 않는다.
   * 끌 때는 디스크를 건드리지 않는다 (pending 재방문자의 값이 나중 granted에서 이어지게)
   */
  setPersistent(persistent: boolean): void {
    if (persistent === this.persistent) return;
    this.persistent = persistent;
    if (!persistent) return;
    for (const [key, value] of this.memory) {
      if (this.get(key) === null) this.writeDisk(key, value);
    }
  }

  clear(): void {
    this.memory.clear();
    this.clearDisk();
  }

  /** denied: SDK가 쓴 디스크 값을 모두 지운다 */
  clearDisk(): void {
    for (const key of PERSISTED_KEYS) this.removeDisk(key);
  }

  get(key: string): string | null {
    if (!this.persistent) return this.memory.get(key) ?? null;
    const cookieName = COOKIE_NAMES[key];
    return safeLocalStorage()?.getItem(key) ?? (cookieName ? readCookie(cookieName) : null);
  }

  set(key: string, value: string): void {
    this.memory.set(key, value);
    if (this.persistent) this.writeDisk(key, value);
  }

  remove(key: string): void {
    this.memory.delete(key);
    this.removeDisk(key);
  }

  getJson<T>(key: string): T | null {
    const raw = this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  }

  private domain(): string | null {
    if (this.cookieDomain === undefined) {
      this.cookieDomain = this.configuredCookieDomain ?? detectCookieDomain(location.hostname);
    }
    return this.cookieDomain;
  }

  private writeDisk(key: string, value: string): void {
    try {
      safeLocalStorage()?.setItem(key, value);
    } catch {
      // 저장 공간 초과나 사파리 비공개 모드: 메모리 값으로 계속 동작한다
    }
    const cookieName = COOKIE_NAMES[key];
    if (cookieName) writeCookie(cookieName, value, (this.cookieDays * DAY_MS) / 1000, this.domain());
  }

  private removeDisk(key: string): void {
    try { safeLocalStorage()?.removeItem(key); } catch { /* storage is unavailable */ }
    const cookieName = COOKIE_NAMES[key];
    if (cookieName && readCookie(cookieName) !== null) {
      // Erase without detectCookieDomain(), which would create a probe cookie.
      writeCookie(cookieName, "", 0, this.configuredCookieDomain);
      const labels = location.hostname.split(".");
      for (let size = 2; size <= labels.length; size++) writeCookie(cookieName, "", 0, labels.slice(-size).join("."));
    }
  }
}
