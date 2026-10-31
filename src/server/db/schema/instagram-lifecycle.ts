import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users, sessions } from "./users";
import { workspaces } from "./workspaces";
import { guideInfluencers } from "./guides";
import { igConnections } from "./performance";
import type { IgTarget } from "../../../shared/performance";

export const igOAuthStates = sqliteTable("ig_oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  nonceHash: text("nonce_hash").notNull(),
  target: text("target").$type<IgTarget>().notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull().references(() => igConnections.id, { onDelete: "cascade" }),
  connectionGeneration: text("connection_generation").notNull(),
  guideInfluencerId: text("guide_influencer_id").references(() => guideInfluencers.id, { onDelete: "cascade" }),
  connectTokenHash: text("connect_token_hash"),
  guideTokenHash: text("guide_token_hash"),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "cascade" }),
  returnMode: text("return_mode").$type<"guide" | "connect" | "settings">().notNull(),
  returnPath: text("return_path").notNull(),
  lang: text("lang").$type<"ko" | "en">().notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("ig_oauth_states_expiry_idx").on(t.expiresAt)]);

export type IgDisconnectMailStatus = "queued" | "sending" | "blocked" | "sent" | "failed" | "unknown" | "cancelled";
export const igDisconnectMailOutbox = sqliteTable("ig_disconnect_mail_outbox", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  connectionGeneration: text("connection_generation").notNull(),
  workspaceId: text("workspace_id").notNull(),
  recipientKind: text("recipient_kind").$type<"brand" | "influencer">().notNull(),
  recipientId: text("recipient_id").notNull(),
  reason: text("reason").notNull(),
  disconnectedAt: integer("disconnected_at").notNull(),
  status: text("status").$type<IgDisconnectMailStatus>().notNull(),
  payloadEnc: text("payload_enc"),
  firstAttemptAt: integer("first_attempt_at"),
  lastAttemptAt: integer("last_attempt_at"),
  nextAttemptAt: integer("next_attempt_at").notNull().default(0),
  leaseToken: text("lease_token"),
  attempts: integer("attempts").notNull().default(0),
  providerId: text("provider_id"),
  errorCode: text("error_code"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [uniqueIndex("ig_disconnect_mail_recipient_idx").on(t.connectionId, t.connectionGeneration, t.recipientKind, t.recipientId), index("ig_disconnect_mail_due_idx").on(t.status, t.nextAttemptAt, t.updatedAt)]);
