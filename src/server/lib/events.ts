import type { Db } from "../db";
import { events } from "../db/schema";
import { newId, now } from "./ids";
import { notifyFromEvent } from "./notifications";

// 이벤트 이름은 스펙 8장 규칙대로 snake_case (예: short_link_created)
// 알림 대상 이벤트(NOTIFY_RULES)면 앱 안 알림도 같이 만든다
export async function logEvent(db: Db, workspaceId: string | null, name: string, props: Record<string, unknown> = {}) {
  await db.insert(events).values({ id: newId(), workspaceId, name, props, at: now() });
  if (workspaceId) await notifyFromEvent(db, workspaceId, name, props);
}

// 한 동작이 이벤트 여러 개를 남길 때. 순서대로 기록한다
export async function logEvents(db: Db, workspaceId: string | null, list: [name: string, props: Record<string, unknown>][]) {
  for (const [name, props] of list) await logEvent(db, workspaceId, name, props);
}
