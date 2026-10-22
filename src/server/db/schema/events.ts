import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id"),
    name: text("name").notNull(),
    props: text("props", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("events_workspace_name_idx").on(t.workspaceId, t.name, t.at)],
);
