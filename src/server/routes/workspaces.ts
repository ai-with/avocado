import { Hono } from "hono";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import type { AppEnv } from "../types";
import type { Db } from "../db";
import { members, workspaces } from "../db/schema";
import { parse } from "../lib/errors";
import { requireAuth, setCurrentWorkspace } from "../middleware/auth";

export function listWorkspaces(db: Db, userId: string) {
  return db
    .select({ id: workspaces.id, name: workspaces.name, plan: workspaces.plan, role: members.role })
    .from(members)
    .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(eq(members.userId, userId))
    .orderBy(asc(members.createdAt));
}

export const workspacesRoutes = new Hono<AppEnv>().post("/switch", requireAuth, async (c) => {
  const { workspaceId } = parse(z.object({ workspaceId: z.string().min(1) }), await c.req.json());
  await setCurrentWorkspace(c, workspaceId);
  return c.json({ workspaceId });
});
