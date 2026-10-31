import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// 쓰기 intent와 삭제 완료 표시를 부모 삭제 뒤에도 남긴다.
export const contentThumbnailObjects = sqliteTable("content_thumbnail_objects", {
  key: text("key").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  contentId: text("content_id").notNull(),
  createdAt: integer("created_at").notNull(),
  retiredAt: integer("retired_at"),
  deletedAt: integer("deleted_at"),
  checkedAt: integer("checked_at").notNull().default(0),
}, (t) => [index("content_thumbnail_objects_sweep_idx").on(t.checkedAt, t.createdAt)]);
