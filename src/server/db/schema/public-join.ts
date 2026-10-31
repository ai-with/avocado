import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const publicJoinLimits = sqliteTable("public_join_limits", {
  key: text("key").primaryKey(),
  hits: integer("hits").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("public_join_limits_expiry_idx").on(table.expiresAt, table.key)]);
