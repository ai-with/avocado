export const NO_AUDIO_PROOF = "static-mp4-v1";
export const AUDIO_UNAVAILABLE_REASONS = ["unsupported_container", "invalid_container", "probe_limit", "read_failed", "decode_failed", "decode_limit"] as const;
export type AudioUnavailableReason = (typeof AUDIO_UNAVAILABLE_REASONS)[number];
export type AudioExtraction = { kind: "audio"; blob: Blob; sampleRate: number; durationS: number }
  | { kind: "no_audio"; proof: typeof NO_AUDIO_PROOF }
  | { kind: "unavailable"; reason: AudioUnavailableReason };

export function transcriptSkipped(error: string | null) {
  if (error === "withdrawn") return { title: "동의를 철회한 영상이에요", description: "철회된 제출물의 음성 분석을 중단했어요." };
  if (error === "no_audio_track") return { title: "음성 없음", description: "오디오 트랙이 없는 영상이에요. 위반 후보는 화면 기준으로만 찾아요." };
  if (error === "no_speech") return { title: "대사 없음", description: "오디오에서 대사를 찾지 못했어요. 위반 후보는 화면 기준으로만 찾아요." };
  return { title: "오디오 확인 불가", description: "음성을 확인하지 못했어요. 대사가 없는 영상으로 판단하지 않으며 영상과 프레임은 그대로 볼 수 있어요." };
}
