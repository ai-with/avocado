import type { Auth } from "../types";
import type { Role } from "../../shared/roles";
import { ApiError } from "./errors";

export type Actor = Pick<Auth, "sessionId" | "user">;
const roleList = (roles: readonly Role[]) => roles.map((role) => `'${role}'`).join(",");
export const sessionPredicate = `EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
  WHERE s.id=? AND s.user_id=? AND s.current_workspace_id IS ? AND s.expires_at>? AND u.phone_verified_at IS NOT NULL)`;
export const authorityPredicate = (roles: readonly Role[]) => `EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
  JOIN members actor ON actor.user_id=s.user_id AND actor.workspace_id=s.current_workspace_id
  WHERE s.id=? AND s.user_id=? AND s.current_workspace_id=? AND s.expires_at>? AND u.phone_verified_at IS NOT NULL AND actor.role IN (${roleList(roles)}))`;
export const actorParams = (actor: Actor, workspaceId: string | null, at: number) => [actor.sessionId, actor.user.id, workspaceId, at] as const;
export const workspaceChanged = () => new ApiError(409, "workspace_changed", "워크스페이스가 바뀌었어요. 화면을 새로 확인해 주세요.");
export const forbidden = () => new ApiError(403, "forbidden", "이 작업을 할 권한이 없어요.");
export const writeUnavailable = () => new ApiError(503, "workspace_unavailable", "요청을 완료하지 못했어요. 잠시 후 같은 요청으로 다시 시도해 주세요.");
export function assertSql(db: D1Database, predicate: string, params: readonly (string | number | null)[]) {
  return db.prepare(`SELECT CASE WHEN (${predicate}) THEN 1 ELSE json('workspace_guard_failed') END AS allowed`).bind(...params);
}
export async function ensureSessionScope(db: D1Database, actor: Actor, expected: string | null | undefined, at: number) {
  const row = await db.prepare("SELECT s.current_workspace_id AS workspaceId,s.expires_at AS expiresAt,u.phone_verified_at AS verifiedAt FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.user_id=?")
    .bind(actor.sessionId, actor.user.id).first<{ workspaceId: string | null; expiresAt: number; verifiedAt: number | null }>();
  if (!row || row.expiresAt <= at) throw new ApiError(401, "unauthorized", "로그인이 필요해요.");
  if (row.verifiedAt === null) throw new ApiError(403, "phone_required", "휴대폰 번호 인증을 먼저 마쳐 주세요.");
  if (expected !== undefined && row.workspaceId !== expected) throw workspaceChanged();
  return row.workspaceId;
}
export async function ensureWorkspaceRole(db: D1Database, actor: Actor, expected: string, roles: readonly Role[], at: number): Promise<Role> {
  await ensureSessionScope(db, actor, expected, at);
  const row = await db.prepare("SELECT role FROM members WHERE workspace_id=? AND user_id=?").bind(expected, actor.user.id).first<{ role: Role }>();
  if (!row || !roles.includes(row.role)) throw forbidden();
  return row.role;
}
// Used again inside the transaction by issue, lookup and consume. NULL is legacy
// only when migration explicitly marked it as such; new strict NULL is invalid.
export const inviteAuthority = (alias = "i") => `((${alias}.issuer_required=0 AND ${alias}.invited_by IS NULL) OR EXISTS
  (SELECT 1 FROM members issuer WHERE issuer.workspace_id=${alias}.workspace_id AND issuer.user_id=${alias}.invited_by AND issuer.role IN ('owner','editor')))`;
