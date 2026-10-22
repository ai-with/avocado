import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "../db";
import { ApiError } from "./errors";

type OwnedTable = SQLiteTable & { id: SQLiteColumn; workspaceId: SQLiteColumn };
type SoftDeletable = OwnedTable & { deletedAt: SQLiteColumn };
export type NotFound = { code: string; message: string };

// 워크스페이스 소유 자원 한 건. 없거나 남의 것이면 404
export async function findOwned<T extends OwnedTable>(db: Db, table: T, id: string, workspaceId: string, notFound: NotFound, extra?: SQL): Promise<T["$inferSelect"]> {
  const row = await db.select().from(table as SQLiteTable).where(and(eq(table.id, id), eq(table.workspaceId, workspaceId), extra)).get();
  if (!row) throw new ApiError(404, notFound.code, notFound.message);
  return row as T["$inferSelect"];
}

// 소프트 삭제(deleted_at)된 행은 없는 것으로 본다
export const findLive = <T extends SoftDeletable>(db: Db, table: T, id: string, workspaceId: string, notFound: NotFound) =>
  findOwned(db, table, id, workspaceId, notFound, isNull(table.deletedAt));
