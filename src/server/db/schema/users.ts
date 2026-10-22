import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  // 구글 전용 계정은 빈 문자열(비밀번호 없음). NOT NULL 해제는 테이블 재생성이 필요해 하지 않았다
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
  // TASK-024 (0007): 구글 로그인, 휴대폰 인증(계정당 번호 1개)
  googleSub: text("google_sub").unique(),
  phoneE164: text("phone_e164").unique(),
  phoneVerifiedAt: integer("phone_verified_at"),
});

// id 는 쿠키 토큰의 SHA-256 hex. 원문 토큰은 저장하지 않는다
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    currentWorkspaceId: text("current_workspace_id"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);
