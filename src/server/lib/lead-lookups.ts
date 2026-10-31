import type { Db } from "../db";
import { ApiError } from "./errors";
import { ensureChannelDefaults } from "./links";

export const lookupKinds = ["guides", "influencers", "channels", "tags", "contents"] as const;
export type LookupKind = typeof lookupKinds[number];
const definitions: Record<LookupKind, { from: string; id: string; fields: string; where?: string }> = {
  guides: { from: "guides t", id: "t.id", fields: "t.id AS id,t.name AS name,NULL AS label" },
  influencers: { from: "influencers t", id: "t.id", fields: "t.id AS id,t.display_name AS name,NULL AS label" },
  channels: { from: "link_channels t", id: "t.key", fields: "t.key AS id,t.name AS name,NULL AS label" },
  tags: { from: "lead_tags t", id: "t.id", fields: "t.id AS id,t.name AS name,NULL AS label" },
  contents: { from: "short_links t LEFT JOIN influencers i ON i.id=t.influencer_id AND i.workspace_id=t.workspace_id", id: "t.id", fields: "t.id AS id,coalesce(t.content_label,'')||' · '||coalesce(i.display_name,'가이드 공용') AS name,coalesce(t.content_label,'') AS label", where: "AND t.content_key IS NOT NULL" },
};
export async function leadLookupPage(db: Db, workspace: string, kind: LookupKind, after = "", selected: string[] = []) {
  const definition = definitions[kind];
  if (!definition || after.length > 200 || selected.length > 1000) throw new ApiError(400, "invalid_lookup", "필터 목록을 확인해 주세요.");
  const scope = `t.workspace_id=? ${definition.where ?? ""}`;
  const cte = `WITH next AS(SELECT ${definition.fields},0 AS selected FROM ${definition.from} WHERE ${scope} AND ${definition.id}>? ORDER BY ${definition.id} LIMIT 101),
    picked AS(SELECT ${definition.fields},1 AS selected FROM ${definition.from} WHERE ${scope} AND ${definition.id} IN(SELECT value FROM json_each(?))),
    result AS(SELECT * FROM next UNION ALL SELECT * FROM picked)`;
  const values = [workspace, after, workspace, JSON.stringify([...new Set(selected)])];
  let results: D1Result[];
  try { results = await db.$client.batch([
    db.$client.prepare(`${cte} SELECT json(CASE WHEN coalesce(sum(64+length(CAST(json_quote(id) AS BLOB))+length(CAST(json_quote(name) AS BLOB))+length(CAST(json_quote(label) AS BLOB))),0)<=262144 THEN 'true' ELSE 'lead_lookup_too_large' END) FROM result`).bind(...values),
    db.$client.prepare(`${cte} SELECT * FROM result`).bind(...values),
  ]); } catch { throw new ApiError(413, "lookup_too_large", "필터 자료가 커서 목록을 불러오지 못했어요."); }
  const rows = results[1]!.results as { id: string; name: string; label: string | null; selected: number }[];
  const prefix = rows.filter((r) => !r.selected), items = [...new Map([...prefix.slice(0, 100), ...rows.filter((r) => r.selected)].map((row) => [row.id, { id: row.id, name: row.name, ...(kind === "contents" && { label: row.label ?? "" }) }])).values()];
  return { items, nextCursor: prefix.length > 100 ? prefix[99]!.id : null };
}
export async function boundedLeadLookups(db: Db, workspace: string, refs: Partial<Record<LookupKind, string[]>> = {}) {
  await ensureChannelDefaults(db, workspace);
  const pages = await Promise.all(lookupKinds.map((kind) => leadLookupPage(db, workspace, kind, "", [...new Set(refs[kind] ?? [])])));
  return { lookups: Object.fromEntries(lookupKinds.map((kind, i) => [kind, kind === "channels" ? pages[i]!.items.map((r) => ({ key: r.id, name: r.name })) : pages[i]!.items])),
    lookupCursors: Object.fromEntries(lookupKinds.map((kind, i) => [kind, pages[i]!.nextCursor])) };
}
