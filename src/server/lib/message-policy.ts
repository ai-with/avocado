import { ApiError } from "./errors";

export type PolicyContext = { workspaceId: string; actorId: string; sourceKind: "broadcast" | "automation"; sourceId: string; runId: string; deliveryId?: string; phase: "authorize" | "attempt" };
export type MessagePolicy = {
  configured: boolean;
  // Trusted server dependency, never selected by Env/HTTP. 347 can compose its
  // current version/capacity checks into the same native transaction as claim.
  condition: (context: PolicyContext) => { sql: string; params: (string | number | null)[] };
};
export const productionMessagePolicy: MessagePolicy = Object.freeze({ configured: false, condition: () => ({ sql: "0", params: [] }) });
export const messagePolicyStatus = () => ({ configured: productionMessagePolicy.configured, reason: "send_policy_unconfigured", message: "발송 인원과 월 한도 기준을 준비하고 있어요. 실제 발송은 아직 사용할 수 없어요." });
export function requireMessagePolicy(policy: MessagePolicy = productionMessagePolicy): void {
  if (!policy.configured) throw new ApiError(503, "send_policy_unconfigured", messagePolicyStatus().message);
}
