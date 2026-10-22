import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { users } from "./users";

// 휴대폰 인증번호. 코드 원문은 저장하지 않는다 (sha256(id:code))
export const phoneVerifications = sqliteTable(
  "phone_verifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    phoneE164: text("phone_e164").notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: text("purpose").$type<"signup" | "change">().notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: integer("expires_at").notNull(),
    verifiedAt: integer("verified_at"),
    ip: text("ip").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("phone_verifications_phone_idx").on(t.phoneE164, t.createdAt), index("phone_verifications_ip_idx").on(t.ip, t.createdAt)],
);

// 구글 OAuth 왕복 동안만 쓰는 1회용 상태 (state, nonce, PKCE verifier)
export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  nonce: text("nonce").notNull(),
  codeVerifier: text("code_verifier").notNull(),
  redirectNext: text("redirect_next").notNull(),
  createdAt: integer("created_at").notNull(),
});

// id 는 재설정 토큰의 SHA-256 hex
export const passwordResets = sqliteTable("password_resets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull(),
});

// 시도 횟수 제한용 기록. key 예: login:<email>, forgot:<email>
export const authAttempts = sqliteTable(
  "auth_attempts",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("auth_attempts_key_idx").on(t.key, t.createdAt)],
);
