import { useEffect, useRef, useState } from "react";

const SELECT_MS = 800;
const TYPE_MS = 35;
const TRANSLATE_MS = 600;

export type SuggestionPhase = "idle" | "selecting" | "typing" | "translating" | "done";
export type SuggestionState = { phase: SuggestionPhase; selected: number; typed: number; sent: boolean };

const IDLE: SuggestionState = { phase: "idle", selected: 0, typed: 0, sent: false };

// 대사 드래그 선택 → 한국어 타이핑 → 번역 중 → 영어 표시. 타이머는 하나만 두고 단계마다 이어 건다
export function useSuggestionSequence(selectionWords: number, text: string, reduced: boolean) {
  const [state, setState] = useState<SuggestionState>(IDLE);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const later = (ms: number, next: () => void) => { timer.current = window.setTimeout(next, ms); };
  const finish = () => setState({ phase: "done", selected: selectionWords, typed: text.length, sent: false });
  const translate = () => {
    setState((s) => ({ ...s, phase: "translating" }));
    later(TRANSLATE_MS, finish);
  };
  const type = (typed: number) => {
    setState({ phase: "typing", selected: selectionWords, typed, sent: false });
    later(TYPE_MS, typed < text.length ? () => type(typed + 1) : translate);
  };
  const select = (selected: number) => {
    setState({ phase: "selecting", selected, typed: 0, sent: false });
    later(SELECT_MS / selectionWords, selected < selectionWords ? () => select(selected + 1) : () => type(0));
  };

  const start = () => {
    window.clearTimeout(timer.current);
    if (reduced) finish();
    else select(0);
  };
  const send = () => setState((s) => ({ ...s, sent: true }));
  return { state, start, send };
}
