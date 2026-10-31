import type { Envelope, SdkEvent } from "../../src/shared/sdk-events";
import {
  BATCH_SIZE,
  FLUSH_INTERVAL_MS,
  KEY_QUEUE,
  MAX_BODY_BYTES,
  MAX_EVENTS_PER_ENVELOPE,
  OFFLINE_MAX_EVENTS,
  OFFLINE_TTL_MS,
  RETRY_DELAYS_MS,
} from "./config";
import type { SdkStorage } from "./storage";

// CORS 사전 요청(preflight) 없이 교차 출처로 보낼 수 있는 형식 (docs/14 5-2)
const CONTENT_TYPE = "text/plain;charset=UTF-8";

export interface TransportOptions {
  endpoint: string;
  storage: SdkStorage;
  buildEnvelope(events: SdkEvent[]): Envelope;
  canPersist(): boolean;
  canSend?(): boolean;
}

interface PendingRetry {
  events: SdkEvent[];
  timer: ReturnType<typeof setTimeout>;
}

const encoder = new TextEncoder();

/** 메모리 큐에 쌓아 20개 또는 5초마다 보내고, 숨김 전환 때 sendBeacon으로 남은 것을 보낸다 */
export class Transport {
  private queue: SdkEvent[] = [];
  private generation = 0;
  private readonly requests = new Set<AbortController>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly retries = new Set<PendingRetry>();

  constructor(private readonly options: TransportOptions) {}

  enqueue(event: SdkEvent, immediate = false): void {
    if (this.options.canSend?.() === false) return;
    this.queue.push(event);
    if (immediate || this.queue.length >= BATCH_SIZE) this.flush();
    else if (this.timer === undefined) this.timer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  flush(): void {
    if (this.options.canSend?.() === false) { this.clear(); return; }
    for (const events of this.takeBatches(this.queue.splice(0))) void this.post(events, 0, this.generation);
  }

  /** visibilitychange hidden 때 부른다. unload·beforeunload는 모바일에서 안 불리고 bfcache를 깬다 */
  flushBeacon(): void {
    if (this.options.canSend?.() === false) { this.clear(); return; }
    const waiting = [...this.retries].flatMap((retry) => {
      clearTimeout(retry.timer);
      return retry.events;
    });
    this.retries.clear();
    for (const events of this.takeBatches([...waiting, ...this.queue.splice(0)])) {
      const sent = typeof navigator.sendBeacon === "function" && navigator.sendBeacon(this.options.endpoint, this.serialize(events));
      if (!sent) this.saveOffline(events);
    }
  }

  /** 동의 철회 시: 보내지 않은 이벤트를 모두 버린다 */
  clear(): void {
    this.generation++;
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const retry of this.retries) clearTimeout(retry.timer);
    this.retries.clear();
    this.queue = [];
  }

  /** 지난 페이지에서 못 보낸 이벤트를 큐 앞에 되돌린다 */
  restoreOffline(): void {
    if (!this.options.canPersist()) return;
    const saved = this.readOffline();
    this.options.storage.remove(KEY_QUEUE);
    if (saved.length === 0) return;
    this.queue.unshift(...saved);
    this.flush();
  }

  private takeBatches(events: SdkEvent[]): SdkEvent[][] {
    clearTimeout(this.timer);
    this.timer = undefined;
    const batches: SdkEvent[][] = [];
    for (let i = 0; i < events.length; i += MAX_EVENTS_PER_ENVELOPE) {
      batches.push(...this.splitBySize(events.slice(i, i + MAX_EVENTS_PER_ENVELOPE)));
    }
    return batches;
  }

  /** 봉투가 60KB를 넘으면 반으로 나눈다. 이벤트 하나가 넘으면 버린다 */
  private splitBySize(events: SdkEvent[]): SdkEvent[][] {
    if (encoder.encode(this.serialize(events)).length <= MAX_BODY_BYTES) return [events];
    if (events.length === 1) return [];
    const half = Math.ceil(events.length / 2);
    return [...this.splitBySize(events.slice(0, half)), ...this.splitBySize(events.slice(half))];
  }

  private serialize(events: SdkEvent[]): string {
    return JSON.stringify(this.options.buildEnvelope(events));
  }

  /** 네트워크 오류·5xx만 2초·8초·30초 간격으로 3회 재시도, 그래도 실패하면 오프라인 버퍼. 4xx는 버린다 */
  private async post(events: SdkEvent[], attempt: number, generation: number): Promise<void> {
    if (generation !== this.generation || this.options.canSend?.() === false) return;
    const controller = new AbortController();
    this.requests.add(controller);
    let shouldRetry: boolean;
    try {
      const response = await fetch(this.options.endpoint, {
        method: "POST",
        body: this.serialize(events),
        headers: { "Content-Type": CONTENT_TYPE },
        keepalive: true,
        redirect: "error",
        signal: controller.signal,
        credentials: "omit",
      });
      shouldRetry = response.status >= 500;
      void response.body?.cancel().catch(() => {});
    } catch {
      shouldRetry = true;
    } finally {
      this.requests.delete(controller);
    }
    if (!shouldRetry || generation !== this.generation || this.options.canSend?.() === false) return;
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      this.saveOffline(events);
      return;
    }
    const retry: PendingRetry = {
      events,
      timer: setTimeout(() => {
        this.retries.delete(retry);
        void this.post(events, attempt + 1, generation);
      }, delay),
    };
    this.retries.add(retry);
  }

  private readOffline(): SdkEvent[] {
    const saved = this.options.storage.getJson<SdkEvent[]>(KEY_QUEUE);
    const oldest = Date.now() - OFFLINE_TTL_MS;
    return Array.isArray(saved) ? saved.filter((event) => event.ts > oldest) : [];
  }

  /** 동의 전(pending)에는 디스크에 쓰지 않는다. 최대 200개, 24시간 */
  private saveOffline(events: SdkEvent[]): void {
    if (!this.options.canPersist()) return;
    const merged = [...this.readOffline(), ...events].slice(-OFFLINE_MAX_EVENTS);
    this.options.storage.setJson(KEY_QUEUE, merged);
  }
}
