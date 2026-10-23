import { Badge, Button, Icon } from "../../../ui";
import { HERO_MOCK } from "../copy";
import type { SuggestionState } from "../useSuggestionSequence";

const LINE_WORDS = HERO_MOCK.line.split(" ");
const SUGGESTION = HERO_MOCK.suggestion;
const SELECTION_START = LINE_WORDS.indexOf(SUGGESTION.selection.split(" ")[0] ?? "");

// ponytail: 균등 분배 근사, 실제 STT 타임스탬프로 교체 가능
function spokenWordIndex(time: number) {
  if (time < HERO_MOCK.lineStart || time >= HERO_MOCK.lineEnd) return -1;
  const perWord = (HERO_MOCK.lineEnd - HERO_MOCK.lineStart) / LINE_WORDS.length;
  return Math.floor((time - HERO_MOCK.lineStart) / perWord);
}

function wordClass(i: number, current: number, selected: number) {
  const isSelected = i >= SELECTION_START && i < SELECTION_START + selected;
  return `landing-word${i === current ? " is-current" : ""}${isSelected ? " is-selected" : ""}`;
}

// 대사 카드. 말하는 단어를 따라가고, 수정 제안이 시작되면 문제 구간이 드래그되듯 선택된다
export function LineCard({ time, suggestion }: { time: number; suggestion: SuggestionState }) {
  const current = spokenWordIndex(time);
  const cursorAfter = suggestion.phase === "selecting" ? SELECTION_START + suggestion.selected - 1 : -2;
  return (
    <div className={`landing-mock-card landing-mock-line ${current >= 0 ? "is-speaking" : ""}`}>
      <p>{LINE_WORDS.map((w, i) => (
        <span key={i}>
          <span className={wordClass(i, current, suggestion.selected)}>{w} </span>
          {i === cursorAfter && <span className="landing-fake-cursor" aria-hidden="true"><Icon name="mouse-pointer" size={16} /></span>}
        </span>
      ))}</p>
      <p className="landing-mock-translation">{HERO_MOCK.translation}</p>
    </div>
  );
}

function SuggestionFoot({ state, onSend }: { state: SuggestionState; onSend: () => void }) {
  if (state.phase === "translating") {
    return (
      <span className="landing-suggest-status">
        <span className="landing-dots" aria-hidden="true"><span /><span /><span /></span>{SUGGESTION.translating}
      </span>
    );
  }
  if (state.phase !== "done") return null;
  return (
    state.sent ? <Badge tone="success">{SUGGESTION.sent}</Badge> : <Button size="sm" onClick={onSend}>{SUGGESTION.send}</Button>
  );
}

// 수정 제안 카드. 글이 차오르는 동안 높이가 바뀌지 않게 남은 글자도 보이지 않게 미리 깔아 둔다
export function SuggestionCard({ state, onSend }: { state: SuggestionState; onSend: () => void }) {
  const { phase, typed } = state;
  return (
    <div className={`landing-mock-card landing-suggest is-${phase}`}>
      {phase === "idle" && <p className="landing-suggest-hint">{SUGGESTION.hint}</p>}
      <div className="landing-suggest-body">
        <strong>{SUGGESTION.title}</strong>
        <p>
          {SUGGESTION.ko.slice(0, typed)}
          {phase === "typing" && <span className="landing-caret" aria-hidden="true" />}
          <span className="landing-suggest-pending">{SUGGESTION.ko.slice(typed)}</span>
        </p>
        <p className="landing-suggest-en">{SUGGESTION.en}</p>
        <div className="landing-suggest-foot"><SuggestionFoot state={state} onSend={onSend} /></div>
      </div>
    </div>
  );
}
