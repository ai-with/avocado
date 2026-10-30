import type { SlotKind } from "./uploadParts";

const KINDS: SlotKind[] = ["final", "clean"];

// 이어 올릴 업로드가 남아 있으면 그 종류로 연다. 둘 다 있으면 검수에 쓰는 완성본부터
export function initialKind(hasSaved: (kind: SlotKind) => boolean, fallback: SlotKind = "final"): SlotKind {
  return KINDS.find(hasSaved) ?? fallback;
}

// 검수는 완성본으로 하므로, 완성본 없이 클린본만 올리려 하면 안내한다
export function needsFinalNotice(kind: SlotKind, hasFinal: boolean): boolean {
  return kind === "clean" && !hasFinal;
}
