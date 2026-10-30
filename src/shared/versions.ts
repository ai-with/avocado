// 업로드 버전 규칙 (TASK-074). 버전 = 완성본 기준, 클린본은 가장 최근 완성본 버전에 붙는다

export type SubmissionKind = "final" | "clean";

// latestFinal: 이미 올라온 완성본 중 가장 큰 버전(없으면 0)
export function assignVersion(kind: SubmissionKind, latestFinal: number): number {
  return kind === "final" ? latestFinal + 1 : Math.max(latestFinal, 1);
}

export type VersionSub = { id: string; version: number; kind: SubmissionKind; status: string; uploadedAt: number | null; createdAt: number };
export type VersionState = "uploading" | "reviewing" | "feedback" | "approved" | "kept_previous";
export type VersionGroup = { version: number; uploadedAt: number | null; finalId: string | null; hasFinal: boolean; hasClean: boolean; state: VersionState };
export type VersionMarks = { approvedId: string | null; supersededIds: Set<string>; sentIds: Set<string> };

const isDone = (s: VersionSub) => s.status !== "uploading" && s.status !== "aborted";

// 같은 버전에 같은 종류가 여러 개면 가장 나중에 만든 것 하나만 쓴다(클린본 재업로드는 대체)
function latestOf(subs: VersionSub[], kind: SubmissionKind) {
  return subs.filter((s) => s.kind === kind).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

function stateOf(main: VersionSub, marks: VersionMarks): VersionState {
  if (!isDone(main)) return "uploading";
  if (marks.approvedId === main.id) return "approved";
  if (marks.supersededIds.has(main.id)) return "kept_previous";
  if (marks.sentIds.has(main.id)) return "feedback";
  return "reviewing";
}

// 버전별 한 줄, 최신 버전 먼저. 취소된 업로드는 빼고, 올리는 중인 클린본은 '클린본 있음'에 세지 않는다
export function groupVersions(subs: VersionSub[], marks: VersionMarks): VersionGroup[] {
  const byVersion = new Map<number, VersionSub[]>();
  for (const s of subs.filter((x) => x.status !== "aborted")) byVersion.set(s.version, [...(byVersion.get(s.version) ?? []), s]);
  return [...byVersion.entries()]
    .sort(([a], [b]) => b - a)
    .map(([version, list]) => {
      const final = latestOf(list, "final");
      const clean = latestOf(list.filter(isDone), "clean");
      const main = final ?? clean ?? latestOf(list, "clean")!;
      return { version, uploadedAt: main.uploadedAt, finalId: final?.id ?? null, hasFinal: !!final, hasClean: !!clean, state: stateOf(main, marks) };
    });
}
