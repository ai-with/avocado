import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import type { MessageLang, TemplatePurpose } from "../../../shared/message-render";
import { workspaces } from "./workspaces";

// 메시지 변수·템플릿 (0019, TASK-073). 기본 변수는 코드 상수라 여기 없다
export const messageVariables = sqliteTable(
  "message_variables",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    defaultValue: text("default_value").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("message_variables_key_unique").on(t.workspaceId, t.key)],
);

export const messageTemplates = sqliteTable(
  "message_templates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    purpose: text("purpose").$type<TemplatePurpose>().notNull().default("contact"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("message_templates_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const messageTemplateBodies = sqliteTable(
  "message_template_bodies",
  {
    templateId: text("template_id").notNull().references(() => messageTemplates.id, { onDelete: "cascade" }),
    lang: text("lang").$type<MessageLang>().notNull(),
    body: text("body").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.lang] })],
);
