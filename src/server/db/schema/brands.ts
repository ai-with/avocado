import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces";
import type { RuleSeverity, RuleTarget } from "../../../shared/guides";
import type { TermKind, TermMatch } from "../../../shared/brand-terms";

// TASK-070 (0017): 워크스페이스 안의 브랜드. 삭제는 deleted_at (캠페인이 있으면 앱이 막는다)
export const brands = sqliteTable(
  "brands",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    logoUrl: text("logo_url"),
    // TASK-079 (0021): 화장품 광고 법규 기본 금지어 사용 여부와 끈 항목 id
    legalPresetEnabled: integer("legal_preset_enabled", { mode: "boolean" }).notNull().default(true),
    legalPresetDisabled: text("legal_preset_disabled", { mode: "json" }).$type<string[]>().notNull().default([]),
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [index("brands_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export type CampaignStatus = "active" | "archived";

// 캠페인 = 브랜드 가이드 1:1. 앱이 만드는 캠페인은 id 를 가이드 id 와 같게 둔다
export const campaigns = sqliteTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull().references(() => brands.id),
    name: text("name").notNull(),
    status: text("status").$type<CampaignStatus>().notNull().default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("campaigns_workspace_idx").on(t.workspaceId, t.createdAt), index("campaigns_brand_idx").on(t.brandId)],
);

// TASK-079 (0021): 브랜드 검수 사전. 같은 브랜드 안 (kind, term) 유일
export const brandTerms = sqliteTable(
  "brand_terms",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    kind: text("kind").$type<TermKind>().notNull(),
    term: text("term").notNull(),
    variants: text("variants", { mode: "json" }).$type<string[]>().notNull().default([]),
    suggestion: text("suggestion"),
    match: text("match").$type<TermMatch>().notNull().default("exact"),
    severity: text("severity").$type<RuleSeverity>().notNull().default("must"),
    targets: text("targets", { mode: "json" }).$type<RuleTarget[]>().notNull(),
    note: text("note").notNull().default(""),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("brand_terms_unique").on(t.brandId, t.kind, t.term)],
);
