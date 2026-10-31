export const ROLES = ["owner", "editor", "approver", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "소유자",
  editor: "편집자",
  approver: "승인자",
  viewer: "열람자",
};

export const INVITABLE_ROLES = ["editor", "approver", "viewer"] as const;
export const WORKSPACE_ROLES = { invite: ["owner", "editor"], manage: ["owner"], survey: ["owner"], skip: ["editor", "approver", "viewer"] } as const;
export const workspaceAllowed = (role: Role | null | undefined, action: keyof typeof WORKSPACE_ROLES) => WORKSPACE_ROLES[action].some((allowed) => allowed === role);
export const canInviteMembers = (role: Role | null | undefined) => workspaceAllowed(role, "invite");
export function needsOnboarding(workspace: { onboardedAt: number | null; onboardingSkippedAt?: number | null } | null, role: Role | null): boolean {
  return !workspace || (workspace.onboardedAt == null && (workspaceAllowed(role, "survey") || workspace.onboardingSkippedAt == null));
}
