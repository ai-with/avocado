import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// R2 작업은 부모 행 삭제 후에도 키와 실패 상태를 잃지 않도록 FK cascade를 두지 않는다.
export const mediaPurges = sqliteTable("media_purges", {
  submissionId: text("submission_id").primaryKey(),
  consentId: text("consent_id").notNull(),
  requestedAt: integer("requested_at").notNull(),
  dueAt: integer("due_at").notNull(),
  nextAttemptAt: integer("next_attempt_at").notNull().default(0),
  completedAt: integer("completed_at"),
  checkedAt: integer("checked_at").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
}, (t) => [index("media_purges_due_idx").on(t.nextAttemptAt, t.dueAt, t.checkedAt)]);

export const mediaPurgeObjects = sqliteTable("media_purge_objects", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").notNull(),
  // 진행 중 부모가 삭제되어도 실제 동의 세대를 복원할 수 있는 쓰기 전 스냅샷.
  consentId: text("consent_id"),
  key: text("key").notNull(),
  kind: text("kind").$type<"object" | "multipart">().notNull(),
  uploadId: text("upload_id"),
  deletedAt: integer("deleted_at"),
  audioWriteUntil: integer("audio_write_until"),
  audioCommittedAt: integer("audio_committed_at"),
  retiredAt: integer("retired_at"),
}, (t) => [uniqueIndex("media_purge_objects_key_idx").on(t.submissionId, t.key, t.kind), index("media_purge_objects_submission_idx").on(t.submissionId, t.deletedAt),
  index("media_retired_audio_idx").on(t.deletedAt, t.retiredAt, t.id).where(sql`${t.retiredAt} IS NOT NULL`),
  index("media_audio_writes_idx").on(t.audioWriteUntil, t.id).where(sql`${t.audioWriteUntil} IS NOT NULL AND ${t.audioCommittedAt} IS NULL AND ${t.retiredAt} IS NULL`)]);
