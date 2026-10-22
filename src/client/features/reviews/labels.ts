import type { BadgeTone } from "../../ui";
import { RULE_TYPE_LABELS, type RuleType } from "../../../shared/guides";
import type { CandidateResult, JobStatus } from "../../../shared/review";

export const RESULT_TONE: Record<CandidateResult, BadgeTone> = { candidate: "danger", needs_check: "warn", compliant: "success", undetermined: "neutral" };
export const RESULT_ORDER: CandidateResult[] = ["candidate", "needs_check", "undetermined", "compliant"];
export const JOB_TONE: Record<JobStatus, BadgeTone> = { queued: "neutral", running: "info", done: "success", failed: "danger", skipped: "neutral" };
export const SOURCE_LABELS = { candidate: "위반 후보", manual: "직접 작성", missed: "놓친 위반" } as const;
export const ruleLabel = (t: string) => RULE_TYPE_LABELS[t as RuleType] ?? t;
