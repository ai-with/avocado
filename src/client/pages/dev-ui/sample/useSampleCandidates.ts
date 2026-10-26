import { useEffect, useMemo, useState } from "react";

export type CandidateStatus = "reviewing" | "proposed" | "accepted";

export type Candidate = {
  id: string;
  name: string;
  handle: string;
  followers: number;
  status: CandidateStatus;
  lastContactAt: number;
};

export const STATUS_LABEL: Record<CandidateStatus, string> = {
  reviewing: "검토 중",
  proposed: "제안함",
  accepted: "수락",
};

const SEED: Candidate[] = [
  { id: "c1", name: "김하루", handle: "haru.toon", followers: 128400, status: "accepted", lastContactAt: Date.parse("2026-10-21T10:00:00+09:00") },
  { id: "c2", name: "박소금", handle: "sogeum_daily", followers: 54210, status: "proposed", lastContactAt: Date.parse("2026-10-18T15:30:00+09:00") },
  { id: "c3", name: "이몽글", handle: "monggle.cut", followers: 9870, status: "reviewing", lastContactAt: Date.parse("2026-10-12T09:10:00+09:00") },
  { id: "c4", name: "최바삭", handle: "basak_comics", followers: 231000, status: "proposed", lastContactAt: Date.parse("2026-10-03T19:45:00+09:00") },
  { id: "c5", name: "정고양", handle: "goyang.diary", followers: 17650, status: "reviewing", lastContactAt: Date.parse("2026-09-28T11:20:00+09:00") },
];

const LOADING_MS = 600;

export type NewCandidate = { name: string; handle: string };

/** 가짜 후보 목록. API 호출 없이 처음 0.6초만 로딩 상태를 흉내 낸다. */
export function useSampleCandidates() {
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CandidateStatus | "">("");

  useEffect(() => {
    const timer = window.setTimeout(() => setRows(SEED), LOADING_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const visible = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) => (!status || r.status === status) && (!q || r.name.toLowerCase().includes(q) || r.handle.toLowerCase().includes(q)),
    );
  }, [rows, query, status]);

  const add = (input: NewCandidate) => {
    const next: Candidate = {
      id: `c${Date.now()}`,
      name: input.name.trim(),
      handle: input.handle.trim().replace(/^@/, ""),
      followers: 0,
      status: "reviewing",
      lastContactAt: Date.now(),
    };
    setRows((prev) => [next, ...(prev ?? [])]);
  };

  const resetFilters = () => {
    setQuery("");
    setStatus("");
  };

  return { visible, query, setQuery, status, setStatus, add, resetFilters };
}
