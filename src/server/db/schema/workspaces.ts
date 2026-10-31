import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Role } from "../../../shared/roles";
import { users } from "./users";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("starter"),
  // TASK-021 (0005): 광고성 메일 하단 전송자 명칭·연락처. 비면 워크스페이스 이름
  senderName: text("sender_name"),
  senderContact: text("sender_contact"),
  // TASK-034 (0010): 온보딩 설문 JSON(건너뛰면 null)과 완료 시각. onboardedAt 이 비면 앱 진입 전에 설문으로 보낸다
  onboarding: text("onboarding"),
  onboardedAt: integer("onboarded_at"),
  createdAt: integer("created_at").notNull(),
});

export const members = sqliteTable(
  "members",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull(),
    createdAt: integer("created_at").notNull(),
    onboardingSkippedAt: integer("onboarding_skipped_at"),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("members_user_idx").on(t.userId)],
);

export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").$type<Role>().notNull(),
    token: text("token").notNull().unique(),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    issuerRequired: integer("issuer_required", { mode: "boolean" }).notNull().default(true),
    expiresAt: integer("expires_at").notNull(),
    acceptedAt: integer("accepted_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("invites_workspace_idx").on(t.workspaceId)],
);

// Stable per-user creation intent; replay never reselects the caller's session.
export const workspaceCreationRequests = sqliteTable("workspace_creation_requests", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestId: text("request_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  state: text("state").$type<"created" | "cancelled">().notNull().default("created"),
  sessionId: text("session_id").notNull(),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.requestId] }), uniqueIndex("workspace_creation_workspace_idx").on(t.workspaceId)]);
