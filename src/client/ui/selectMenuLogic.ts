// SelectMenu 순수 로직: 거르기, 묶기, 키 이동, 글자로 찾기, 고르기. React 와 분리해 vitest 로 시험한다

export type SelectOption = {
  value: string;
  label: string;
  /** 이름 아래 작은 설명 한 줄 */
  description?: string;
  disabled?: boolean;
  /** 같은 group 끼리 묶어 제목을 단다. 원래 순서에서 처음 나온 자리에 묶음이 놓인다 */
  group?: string;
};

export type OptionGroup = { label?: string; items: { option: SelectOption; index: number }[] };

/** 선택지가 이만큼 이상이면 검색칸을 자동으로 보인다 */
export const SEARCH_THRESHOLD = 8;
/** 글자로 찾기: 이 시간 안에 친 글자는 이어서 한 단어로 본다 */
export const TYPEAHEAD_RESET_MS = 500;

export const shouldSearch = (count: number, searchable?: boolean) => searchable ?? count >= SEARCH_THRESHOLD;

const fold = (text: string) => text.toLocaleLowerCase("ko").normalize("NFC");

// 이름·설명에 검색어가 들어 있는 것만. 앞뒤 공백은 무시
export function filterOptions(options: SelectOption[], query: string): SelectOption[] {
  const q = fold(query.trim());
  if (!q) return options;
  return options.filter((o) => fold(o.label).includes(q) || (o.description !== undefined && fold(o.description).includes(q)));
}

// 화면에 그릴 묶음. index 는 거른 목록 안 위치(활성 항목·aria-activedescendant 기준)
export function groupOptions(options: SelectOption[]): OptionGroup[] {
  const groups: OptionGroup[] = [];
  const byLabel = new Map<string | undefined, OptionGroup>();
  options.forEach((option, index) => {
    let group = byLabel.get(option.group);
    if (!group) {
      group = { label: option.group, items: [] };
      byLabel.set(option.group, group);
      groups.push(group);
    }
    group.items.push({ option, index });
  });
  return groups;
}

// 묶음 순서대로 펼친 목록. 키 이동은 화면에 보이는 순서를 따라야 해서 이 순서를 쓴다
export const visualOrder = (options: SelectOption[]): SelectOption[] => groupOptions(options).flatMap((g) => g.items.map((i) => i.option));

const enabledIndexes = (options: SelectOption[]) => options.flatMap((o, i) => (o.disabled ? [] : [i]));

export type MoveKey = "ArrowDown" | "ArrowUp" | "Home" | "End" | "PageDown" | "PageUp";
const PAGE_STEP = 10;

// 비활성 항목은 건너뛴다. 끝에서 멈춘다(처음·끝을 넘어 돌지 않음, WAI-ARIA listbox 권장). 고를 것이 없으면 -1
export function moveActive(options: SelectOption[], current: number, key: MoveKey): number {
  const enabled = enabledIndexes(options);
  if (enabled.length === 0) return -1;
  const pos = enabled.indexOf(current);
  const last = enabled.length - 1;
  const step: Record<MoveKey, number> = {
    ArrowDown: pos === -1 ? 0 : Math.min(pos + 1, last),
    ArrowUp: pos === -1 ? last : Math.max(pos - 1, 0),
    Home: 0,
    End: last,
    PageDown: pos === -1 ? 0 : Math.min(pos + PAGE_STEP, last),
    PageUp: pos === -1 ? 0 : Math.max(pos - PAGE_STEP, 0),
  };
  return enabled[step[key]] ?? -1;
}

// 글자로 찾기: 지금 위치 다음부터 한 바퀴 돌며 이름이 buffer 로 시작하는 첫 항목. 같은 글자를 거듭 치면 그 글자 항목을 차례로 돈다
export function typeaheadIndex(options: SelectOption[], current: number, buffer: string): number {
  const q = fold(buffer);
  if (!q) return -1;
  const first = q.charAt(0);
  const sameChar = [...q].every((c) => c === first);
  const needle = sameChar ? first : q;
  const start = sameChar || q.length === 1 ? current + 1 : current;
  for (let k = 0; k < options.length; k++) {
    const i = (Math.max(start, 0) + k) % options.length;
    const option = options[i];
    if (option && !option.disabled && fold(option.label).startsWith(needle)) return i;
  }
  return -1;
}

export const toggleValue = (values: string[], value: string): string[] =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value];

// 닫힌 칸에 보일 글. 단일은 이름, 다중은 "N개 선택"
export function summaryLabel(options: SelectOption[], values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return options.find((o) => o.value === values[0])?.label ?? "";
  return `${values.length}개 선택`;
}
