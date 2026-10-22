import type { Envelope, SdkEvent } from "../../../shared/sdk-events";

// 원본 이벤트를 Analytics Engine 데이터 포인트로 (docs/14 6-4). index 를 사이트 ID 로 두어 샘플링이 큰 사이트부터 걸리게 한다
// blob: 1 t, 2 path, 3 sel, 4 클릭 ID(avc), 5 session, 6 vw / double: 1 x, 2 y, 3 depth 또는 ms 또는 value

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function metric(e: SdkEvent): number {
  if (e.t === "scroll") return e.depth;
  if (e.t === "dwell") return e.ms;
  if (e.t === "conversion") return e.value ?? 0;
  return 0;
}

export function toDataPoint(siteId: string, env: Envelope, e: SdkEvent): AnalyticsEngineDataPoint {
  const click = e.t === "click" ? e : null;
  const sel = click?.sel ?? (e.t === "form_submit" ? e.sel : e.t === "track" ? e.name : "");
  return {
    indexes: [siteId],
    blobs: [e.t, pathOf(e.url), sel, env.attr.last?.clickId ?? "", env.sess, click?.vw ?? ""],
    doubles: [click?.x ?? 0, click?.y ?? 0, metric(e)],
  };
}

// 이벤트는 봉투당 최대 50개라 호출당 250포인트 한도 안이다. 로컬·장애 시 실패해도 수집(Queue)은 계속한다
export function writeEvents(dataset: AnalyticsEngineDataset | undefined, siteId: string, env: Envelope) {
  if (!dataset) return;
  try {
    for (const e of env.events) dataset.writeDataPoint(toDataPoint(siteId, env, e));
  } catch (err) {
    console.error("[collect] analytics engine", err);
  }
}
