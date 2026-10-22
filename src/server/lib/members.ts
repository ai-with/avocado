import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { members, users } from "../db/schema";
import type { Role } from "../../shared/roles";

// 알림 메일 받는 사람: 워크스페이스에서 해당 역할인 구성원 이메일
export function memberEmails(db: Db, workspaceId: string, roles: Role[]) {
  return db
    .select({ email: users.email })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.workspaceId, workspaceId), inArray(members.role, roles)));
}
