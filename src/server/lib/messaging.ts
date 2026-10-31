import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { alimtalkChannels, messageLogs, workspaces } from "../db/schema";
import { newId, now } from "./ids";
import { enqueueMessageMaintenance, messageEngine } from "./message-engine";
import type { Channel, SkipReason, Trigger } from "../../shared/messaging";

// Hooks stage durable source IDs in one set-based statement. They never send.
export const enqueueAutomations = (db: Db, event: { workspaceId: string; trigger: Trigger; leadId: string; ref: { id: string; guideId: string | null } }) => messageEngine.enqueueAutomation(db, event);
export async function senderInfo(db: Db, workspaceId: string) {
  const w = await db.select({ name: workspaces.name, senderName: workspaces.senderName, senderContact: workspaces.senderContact }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  return { senderName: w?.senderName || w?.name || "", senderContact: w?.senderContact || "" };
}
export async function alimtalkConnected(db: Db, workspaceId: string) {
  return (await db.select({ status: alimtalkChannels.status }).from(alimtalkChannels).where(eq(alimtalkChannels.workspaceId, workspaceId)).get())?.status === "connected";
}
export async function logMessage(db: Db, value: { id?: string; workspaceId: string; leadId: string | null; source: "automation" | "broadcast" | "test"; sourceId: string; channel: Channel; status: "sent" | "skipped" | "failed"; reason: SkipReason | null; providerId?: string | null; recipientEmail?: string | null; leadCreatedAt?: number | null }) {
  const { id = newId(), ...fields } = value;
  await db.insert(messageLogs).values({ id, ...fields, at: now() });
}
// Cron is one bounded Queue producer. Broadcast/automation recipients execute
// only in the common per-recipient engine, never a synchronous50-row loop.
export const processMessaging = enqueueMessageMaintenance;
