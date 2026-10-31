import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";
import { sites } from "./sites";

export const siteFxRates = sqliteTable("site_fx_rates", {
  day: text("day").primaryKey(),
  rates: text("rates", { mode: "json" }).$type<Record<string, number>>().notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});
export const siteFxRefresh = sqliteTable("site_fx_refresh", {
  id: text("id").primaryKey(),
  nextEnqueueAt: integer("next_enqueue_at").notNull().default(0),
  nextAttemptAt: integer("next_attempt_at").notNull().default(0),
  leaseUntil: integer("lease_until").notNull().default(0),
  lastSuccessAt: integer("last_success_at").notNull().default(0),
});

export const siteCurrencyTotals = sqliteTable("site_currency_totals", {
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  receivedDay: text("received_day").notNull(),
  occurredDay: text("occurred_day").notNull(),
  currency: text("currency").notNull(),
  conversions: integer("conversions").notNull(),
  valuedCount: integer("valued_count").notNull(),
  valueSum: real("value_sum"),
}, (t) => [primaryKey({ columns: [t.siteId, t.receivedDay, t.occurredDay, t.currency] })]);
