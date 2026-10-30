import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { brands, brandTerms } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { findBrand } from "../../lib/brands";
import { listBrandTerms, toBrandTerm } from "../../lib/brand-terms";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { RULE_TARGETS } from "../../../shared/guides";
import { TERM_KINDS } from "../../../shared/brand-terms";
import { COSMETIC_AD_TERMS, LEGAL_CATEGORY_LABELS, LEGAL_SOURCES } from "../../../shared/cosmetic-ad-terms";

// 브랜드 검수 사전 (/api/brands/:brandId/terms, /api/brands/:brandId/legal-preset, /api/review-presets) (TASK-079)

const MAX_VARIANTS = 20;
const shortText = (max: number) => z.string().trim().max(max);
const termFields = z.object({
  kind: z.enum(TERM_KINDS),
  term: shortText(100).min(1, "항목을 입력해 주세요."),
  variants: z.array(shortText(100).min(1)).max(MAX_VARIANTS),
  suggestion: shortText(200).nullable(),
  match: z.enum(["exact", "similar"]),
  severity: z.enum(["must", "should"]),
  targets: z.array(z.enum(RULE_TARGETS)).min(1, "검사 대상을 하나 이상 골라 주세요."),
  note: shortText(300),
  enabled: z.boolean(),
});
const createBody = termFields.partial().required({ kind: true, term: true });
const patchBody = termFields.omit({ kind: true }).partial();
const presetBody = z.object({ enabled: z.boolean(), disabled: z.array(z.string().max(60)).max(COSMETIC_AD_TERMS.length) }).partial();

const TERM_DEFAULTS = { variants: [], suggestion: null, match: "exact" as const, severity: "must" as const, note: "", enabled: true };
const DEFAULT_TARGETS = { required_ment: ["speech"], forbidden: ["speech"], hashtag: ["caption"], product_name: ["speech", "screen_text"] } as const;

const duplicate = () => new ApiError(409, "term_duplicate", "이미 같은 항목이 있어요.", { term: "이미 같은 항목이 있어요." });
const notFound = () => new ApiError(404, "term_not_found", "사전 항목을 찾을 수 없어요.");
const uniq = (list: string[]) => [...new Set(list)];

async function ownBrand(c: Context<AppEnv>) {
  const { workspace } = workspaceCtx(c);
  return findBrand(c.var.db, workspace.id, c.req.param("brandId") ?? "");
}

async function findTerm(db: Db, brandId: string, id: string) {
  const row = await db.select().from(brandTerms).where(and(eq(brandTerms.id, id), eq(brandTerms.brandId, brandId))).get();
  if (!row) throw notFound();
  return row;
}

async function assertUnique(db: Db, brandId: string, kind: string, term: string, exceptId: string | null) {
  const same = await db
    .select({ id: brandTerms.id })
    .from(brandTerms)
    .where(and(eq(brandTerms.brandId, brandId), eq(brandTerms.kind, kind as (typeof TERM_KINDS)[number]), eq(brandTerms.term, term), exceptId ? ne(brandTerms.id, exceptId) : undefined))
    .get();
  if (same) throw duplicate();
}

export const brandTermRoutes = new Hono<AppEnv>()
  .get("/:brandId/terms", async (c) => {
    const b = await ownBrand(c);
    const rows = await listBrandTerms(c.var.db, b.id);
    return c.json({ brand: { id: b.id, name: b.name, legalPreset: { enabled: b.legalPresetEnabled, disabled: b.legalPresetDisabled } }, terms: rows.map(toBrandTerm) });
  })
  .post("/:brandId/terms", editorsOnly, async (c) => {
    const body = parse(createBody, await c.req.json());
    const b = await ownBrand(c);
    const db = c.var.db;
    await assertUnique(db, b.id, body.kind, body.term, null);
    const id = newId();
    const targets = body.targets ?? [...DEFAULT_TARGETS[body.kind]];
    const variants = uniq(body.variants ?? []);
    await db.insert(brandTerms).values({ ...TERM_DEFAULTS, ...body, variants, targets, id, workspaceId: b.workspaceId, brandId: b.id, createdAt: now(), updatedAt: now() });
    return c.json({ id }, 201);
  })
  .patch("/:brandId/terms/:id", editorsOnly, async (c) => {
    const body = parse(patchBody, await c.req.json());
    const b = await ownBrand(c);
    const db = c.var.db;
    const t = await findTerm(db, b.id, c.req.param("id"));
    if (body.term) await assertUnique(db, b.id, t.kind, body.term, t.id);
    await db.update(brandTerms).set({ ...body, variants: body.variants ? uniq(body.variants) : undefined, updatedAt: now() }).where(eq(brandTerms.id, t.id));
    return c.json({ ok: true });
  })
  .delete("/:brandId/terms/:id", editorsOnly, async (c) => {
    const b = await ownBrand(c);
    const t = await findTerm(c.var.db, b.id, c.req.param("id"));
    await c.var.db.delete(brandTerms).where(eq(brandTerms.id, t.id));
    return c.json({ ok: true });
  })
  .patch("/:brandId/legal-preset", editorsOnly, async (c) => {
    const body = parse(presetBody, await c.req.json());
    const b = await ownBrand(c);
    const known = new Set(COSMETIC_AD_TERMS.map((t) => t.id));
    const disabled = body.disabled ? uniq(body.disabled).filter((id) => known.has(id)) : undefined;
    await c.var.db.update(brands).set({ legalPresetEnabled: body.enabled, legalPresetDisabled: disabled }).where(eq(brands.id, b.id));
    return c.json({ ok: true });
  });

export const reviewPresetRoutes = new Hono<AppEnv>().get("/cosmetic", (c) => {
  workspaceCtx(c);
  return c.json({ terms: COSMETIC_AD_TERMS, categories: LEGAL_CATEGORY_LABELS, sources: LEGAL_SOURCES });
});
