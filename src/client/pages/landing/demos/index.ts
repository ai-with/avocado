import type { ComponentType } from "react";
import { CandidatesDemo } from "./CandidatesDemo";
import { FeedbackDemo } from "./FeedbackDemo";
import { GuideDemo } from "./GuideDemo";
import { LinksDemo } from "./LinksDemo";
import { TranscriptDemo } from "./TranscriptDemo";
import { UploadDemo } from "./UploadDemo";

export type FeatureId = "guide" | "upload" | "transcript" | "candidates" | "feedback" | "links";

// 기능 블록 id별 인터랙션 데모
export const DEMOS: Record<FeatureId, ComponentType> = {
  guide: GuideDemo,
  upload: UploadDemo,
  transcript: TranscriptDemo,
  candidates: CandidatesDemo,
  feedback: FeedbackDemo,
  links: LinksDemo,
};
