import { IG_SCOPES, type IgTarget } from "../../shared/performance";
import type { IgFail } from "./instagram";
import { now } from "./ids";
import { sql } from "drizzle-orm";

export type IgDisconnectReason = "expired" | "token_missing" | "provider_auth_invalid" | "manual";
export type IgConnectionReason = IgDisconnectReason | "grant_unverified" | "permissions_missing" | "not_professional";
export type IgConnectionLike = {
  target: IgTarget;
  connectedAt: number | null;
  tokenEnc: string | null;
  expiresAt: number | null;
  revokedAt: number | null;
  disconnectedAt: number | null;
  disconnectedReason: string | null;
  grantsVerifiedAt: number | null;
  scopes: string[];
  accountType: string | null;
};

export const igGrantVerified = (row: IgConnectionLike): boolean => typeof row.grantsVerifiedAt === "number" && Number.isFinite(row.grantsVerifiedAt) && row.grantsVerifiedAt > 0
  && ["BUSINESS", "CREATOR", "MEDIA_CREATOR"].includes(row.accountType?.toUpperCase() ?? "")
  && Array.isArray(row.scopes) && row.scopes.every((scope) => typeof scope === "string") && Boolean(IG_SCOPES[row.target]) && IG_SCOPES[row.target].every((scope) => row.scopes.includes(scope));

export function igConnectionState(row: IgConnectionLike | null | undefined, at = now()): {
  connected: boolean; expired: boolean; disconnected: boolean; reason: IgConnectionReason | null;
} {
  const result = (reason: IgConnectionReason | null, expired = false, disconnected = false) => ({ connected: false, expired, disconnected, reason });
  if (!row?.connectedAt) return result(null);
  if (row.revokedAt !== null || row.disconnectedAt !== null) {
    const reason = ["expired", "token_missing", "provider_auth_invalid", "manual"].includes(row.disconnectedReason ?? "") ? row.disconnectedReason as IgDisconnectReason : "manual";
    return result(reason, reason === "expired", true);
  }
  // 옛 코드가 요청 범위를 그대로 저장한 scopes는 실제 승인 증거로 취급하지 않는다.
  if (typeof row.grantsVerifiedAt !== "number" || !Number.isFinite(row.grantsVerifiedAt) || row.grantsVerifiedAt <= 0) return result("grant_unverified");
  if (!["BUSINESS", "CREATOR", "MEDIA_CREATOR"].includes(row.accountType?.toUpperCase() ?? "")) return result("not_professional");
  if (!Array.isArray(row.scopes) || row.scopes.some((scope) => typeof scope !== "string") || !IG_SCOPES[row.target]?.every((scope) => row.scopes.includes(scope))) return result("permissions_missing");
  if (!row.tokenEnc) return result("token_missing", false, true);
  if (row.expiresAt === null || row.expiresAt <= at) return result("expired", true, true);
  return { connected: true, expired: false, disconnected: false, reason: null };
}

export const igConnectionUsable = (row: IgConnectionLike | null | undefined, at = now()): boolean => igConnectionState(row, at).connected;

export function igGrantVerifiedSql(alias: "g" | "c" | "ig_connections") {
  const column = (name: string) => sql.raw(`${alias}.${name}`);
  return sql`${column("grants_verified_at")} IS NOT NULL AND ${column("grants_verified_at")}>0
    AND upper(${column("account_type")}) IN ('BUSINESS','CREATOR','MEDIA_CREATOR') AND ${column("target")} IN ('influencer','client_brand','brand_sender')
    AND json_type(CASE WHEN json_valid(${column("scopes")}) THEN ${column("scopes")} ELSE 'null' END)='array'
    AND NOT EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(${column("scopes")}) THEN ${column("scopes")} ELSE '[]' END) value WHERE value.type<>'text')
    AND NOT EXISTS(SELECT 1 FROM json_each(CASE WHEN ${column("target")}='brand_sender' THEN ${JSON.stringify(IG_SCOPES.brand_sender)} ELSE ${JSON.stringify(IG_SCOPES.influencer)} END) required
      WHERE NOT EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(${column("scopes")}) THEN ${column("scopes")} ELSE '[]' END) granted WHERE granted.value=required.value))`;
}
export function igConnectionUsableSql(alias: "g" | "c" | "ig_connections", at = now()) {
  const column = (name: string) => sql.raw(`${alias}.${name}`);
  return sql`${column("connected_at")}>0 AND ${column("revoked_at")} IS NULL AND ${column("disconnected_at")} IS NULL
    AND ${column("token_enc")} IS NOT NULL AND ${column("token_enc")}<>'' AND ${column("expires_at")}>${at} AND ${igGrantVerifiedSql(alias)}`;
}

export function definitiveIgDisconnect(error: IgFail): IgDisconnectReason | null {
  // 190은 공통 인증 실패만 확정한다. permission/일시 오류를 계정 전체 철회로 추정하지 않는다.
  return error.authFailure === true && error.code === 190 && error.transient !== true ? "provider_auth_invalid" : null;
}
