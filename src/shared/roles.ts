export const ROLES = ["owner", "editor", "approver", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "소유자",
  editor: "편집자",
  approver: "승인자",
  viewer: "열람자",
};
