// Whole-field ECMAScript lowercasing preserves the current search semantics.
// Nullable original values become the empty (fully prepared) search string.
export type SearchProfile = { email: string; name?: string | null; company?: string | null; phone?: string | null };
export const leadSearchValues = (profile: SearchProfile) => ({
  searchEmailV1: profile.email.toLowerCase(), searchNameV1: (profile.name ?? "").toLowerCase(),
  searchCompanyV1: (profile.company ?? "").toLowerCase(), searchPhoneV1: (profile.phone ?? "").toLowerCase(),
});
export const searchPendingSql = (alias = "l") => ["email", "name", "company", "phone"].map((key) => `${alias}.search_${key}_v1 IS NULL`).join(" OR ");
// Import owner supplies its existing guarded row selection/claim. input is a
// json_each row containing the original fields and leadSearchValues() fields.
export function leadSearchMergeSql(input: string, alias = "l") {
  return ["email", "name", "company", "phone"].map((key) => {
    const folded = `json_extract(${input},'$.search${key[0]!.toUpperCase()}${key.slice(1)}V1')`;
    return `search_${key}_v1=CASE WHEN json_extract(${input},'$.${key}') IS NOT NULL THEN ${folded}
      WHEN ${alias}.${key} IS NULL THEN '' ELSE ${alias}.search_${key}_v1 END`;
  }).join(",");
}

export async function backfillLeadSearch(env: Env, payload: unknown = {}): Promise<void> {
  const after = payload && typeof payload === "object" && typeof (payload as { after?: unknown }).after === "string" ? (payload as { after: string }).after : "";
  if (after.length > 200) throw new Error("lead_search_job_invalid");
  try {
    const candidates = await env.DB.prepare(`SELECT l.id,coalesce(length(CAST(email AS BLOB)),0)+coalesce(length(CAST(name AS BLOB)),0)+coalesce(length(CAST(company AS BLOB)),0)+coalesce(length(CAST(phone AS BLOB)),0) AS bytes
      FROM leads l WHERE l.deleted_at IS NULL AND (${searchPendingSql()}) AND l.id>? ORDER BY l.id LIMIT 100`).bind(after).all<{ id: string; bytes: number }>();
    let bytes = 0; const ids = candidates.results.filter((row) => { if (row.bytes > 65_536 || bytes + row.bytes > 65_536) return false; bytes += row.bytes; return true; }).map((row) => row.id);
    const large = ids.length === 0 && candidates.results.length > 0;
    if (large) { if (candidates.results[0]!.bytes > 2_000_000) throw new Error("lead_search_projection_too_large"); ids.push(candidates.results[0]!.id); }
    let changed = 0;
    if (ids.length) {
      const profiles = await env.DB.prepare(`SELECT id,workspace_id,created_at,email,name,company,phone FROM leads l WHERE l.deleted_at IS NULL AND (${searchPendingSql()}) AND l.id IN(SELECT value FROM json_each(?))`)
        .bind(JSON.stringify(ids)).all<{ id: string; workspace_id: string; created_at: number; email: string; name: string | null; company: string | null; phone: string | null }>();
      const values = profiles.results.map((row) => ({ ...row, ...leadSearchValues(row) }));
      if (large && values[0]) {
        const value = values[0];
        if (Object.values(leadSearchValues(value)).some((v) => new TextEncoder().encode(v).byteLength > 2_000_000)) throw new Error("lead_search_projection_too_large");
        const result = await env.DB.prepare(`UPDATE leads SET search_email_v1=?,search_name_v1=?,search_company_v1=?,search_phone_v1=? WHERE id=? AND workspace_id=? AND created_at=? AND deleted_at IS NULL AND email IS ? AND name IS ? AND company IS ? AND phone IS ?`)
          .bind(value.searchEmailV1, value.searchNameV1, value.searchCompanyV1, value.searchPhoneV1, value.id, value.workspace_id, value.created_at, value.email, value.name, value.company, value.phone).run();
        changed = result.meta.changes;
      } else {
        const encoded = JSON.stringify(values);
        if (new TextEncoder().encode(encoded).byteLength > 1_048_576) throw new Error("lead_search_batch_too_large");
        const result = await env.DB.prepare(`UPDATE leads AS l SET search_email_v1=json_extract(v.value,'$.searchEmailV1'),search_name_v1=json_extract(v.value,'$.searchNameV1'),search_company_v1=json_extract(v.value,'$.searchCompanyV1'),search_phone_v1=json_extract(v.value,'$.searchPhoneV1')
        FROM json_each(?) v WHERE l.id=json_extract(v.value,'$.id') AND l.workspace_id=json_extract(v.value,'$.workspace_id') AND l.created_at=json_extract(v.value,'$.created_at') AND l.deleted_at IS NULL
        AND (${searchPendingSql()}) AND l.email IS json_extract(v.value,'$.email') AND l.name IS json_extract(v.value,'$.name') AND l.company IS json_extract(v.value,'$.company') AND l.phone IS json_extract(v.value,'$.phone')`).bind(encoded).run();
        changed = result.meta.changes;
      }
    }
    if (candidates.results.length === 100 || changed > 0 && candidates.results.length > ids.length) await env.PIPELINE.sendBatch([{ body: { type: "lead_search_backfill", payload: { after: changed > 0 && candidates.results.length > ids.length ? after : candidates.results.at(-1)!.id } } }]);
    console.log("[lead_search_backfill]", JSON.stringify({ selected: candidates.results.length, changed, largeRows: large ? 1 : 0, deferred: candidates.results.length - ids.length, failures: 0 }));
  } catch { console.error("[lead_search_backfill_failed]", JSON.stringify({ failures: 1 })); throw new Error("lead_search_backfill_failed"); }
}
