import { newToken, now } from "../ids";

const LEASE_MS = 30_000;
export type CollectLease = { siteId: string; workspaceId: string; token: string };
export class CollectLeaseBusy extends Error {
  constructor(readonly delaySeconds: number) { super("collect_lease_busy"); }
}

// Claim before reading dedupe/session state. The final batch proves the random
// token, rather than assuming that wall-clock lease expiry implies ownership.
export async function claimCollectLease(db: D1Database, siteId: string, workspaceId: string): Promise<CollectLease | null> {
  const token = newToken(24), at = now();
  const claimed = await db.prepare(`INSERT INTO site_collect_leases (site_id,token,expires_at)
    SELECT id,?,? FROM sites WHERE id=? AND workspace_id=? AND deleted_at IS NULL
    ON CONFLICT(site_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at
    WHERE site_collect_leases.expires_at<=? RETURNING token`).bind(token, at + LEASE_MS, siteId, workspaceId, at).first<{ token: string }>();
  if (claimed?.token === token) return { siteId, workspaceId, token };
  const state = await db.prepare(`SELECT
    EXISTS(SELECT 1 FROM sites WHERE id=? AND workspace_id=? AND deleted_at IS NULL) AS active,
    (SELECT expires_at FROM site_collect_leases WHERE site_id=?) AS expiresAt`).bind(siteId, workspaceId, siteId).first<{ active: number; expiresAt: number | null }>();
  if (!state?.active) return null;
  throw new CollectLeaseBusy(Math.min(60, Math.max(1, Math.ceil(((state.expiresAt ?? at + LEASE_MS) - at) / 1000))));
}

export function assertCollectLease(db: D1Database, lease: CollectLease) {
  return db.prepare(`SELECT json(CASE WHEN EXISTS(SELECT 1 FROM site_collect_leases l JOIN sites s ON s.id=l.site_id
    WHERE l.site_id=? AND l.token=? AND s.workspace_id=? AND s.deleted_at IS NULL)
    THEN 'true' ELSE 'collect_lease_lost' END) AS owned`).bind(lease.siteId, lease.token, lease.workspaceId);
}

export const releaseCollectLease = (db: D1Database, lease: CollectLease) => db.prepare("DELETE FROM site_collect_leases WHERE site_id=? AND token=?").bind(lease.siteId, lease.token);
