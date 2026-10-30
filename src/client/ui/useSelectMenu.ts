import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { filterOptions, moveActive, shouldSearch, toggleValue, typeaheadIndex, TYPEAHEAD_RESET_MS, visualOrder, type MoveKey, type SelectOption } from "./selectMenuLogic";

type Options = {
  options: SelectOption[];
  values: string[];
  multiple: boolean;
  searchable?: boolean;
  onValues: (next: string[]) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

const MOVE_KEYS = new Set<string>(["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"]);
const isPrintable = (e: KeyboardEvent) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

// 글자로 찾기: 짧은 시간 안에 친 글자를 모아 한 단어로 본다
function useTypeahead() {
  const buffer = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return useCallback((char: string) => {
    clearTimeout(timer.current);
    buffer.current += char;
    timer.current = setTimeout(() => (buffer.current = ""), TYPEAHEAD_RESET_MS);
    return buffer.current;
  }, []);
}

// 열 때 가리킬 항목: 지정이 없으면 고른 값, 고른 값이 없으면 첫 항목
function initialActive(options: SelectOption[], values: string[], at?: "first" | "last"): number {
  const full = visualOrder(options);
  const selected = full.findIndex((o) => values.includes(o.value) && !o.disabled);
  if (at === "last") return moveActive(full, -1, "End");
  return at === "first" || selected < 0 ? moveActive(full, -1, "Home") : selected;
}

type KeyContext = {
  options: SelectOption[];
  list: SelectOption[];
  active: number;
  search: boolean;
  setActive: (next: number | ((i: number) => number)) => void;
  openMenu: (at?: "first" | "last") => void;
  close: (restoreFocus: boolean) => void;
  choose: (option: SelectOption | undefined) => void;
  typed: (char: string) => string;
};

function onClosedKey(e: KeyboardEvent, c: KeyContext) {
  if (["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End"].includes(e.key)) {
    e.preventDefault();
    c.openMenu(e.key === "Home" ? "first" : e.key === "End" || e.key === "ArrowUp" ? "last" : undefined);
  } else if (isPrintable(e) && !c.search) {
    c.openMenu();
    c.setActive(typeaheadIndex(visualOrder(c.options), -1, c.typed(e.key)));
  }
}

function onOpenKey(e: KeyboardEvent, c: KeyContext) {
  if (MOVE_KEYS.has(e.key)) {
    e.preventDefault();
    return c.setActive((i) => moveActive(c.list, i, e.key as MoveKey));
  }
  if (e.key === "Enter" || (e.key === " " && !c.search)) {
    e.preventDefault();
    return c.choose(c.list[c.active]);
  }
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation(); // 모달·드로어가 같은 Esc 로 함께 닫히지 않게
    return c.close(true);
  }
  if (e.key === "Tab") return c.close(true); // 칸으로 포커스를 돌린 뒤 기본 Tab 이 그다음 칸으로 옮긴다(모달 포커스 가두기와도 맞물림)
  if (isPrintable(e) && !c.search) c.setActive((i) => typeaheadIndex(c.list, i, c.typed(e.key)));
}

// 열고 닫기, 검색어, 활성 항목(키보드로 가리킨 항목), 고르기. WAI-ARIA combobox + listbox 패턴의 키 동작은 위 두 함수
export function useSelectMenu({ options, values, multiple, searchable, onValues, triggerRef }: Options) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const typed = useTypeahead();
  const search = shouldSearch(options.length, searchable);
  const list = useMemo(() => visualOrder(filterOptions(options, query)), [options, query]);
  const openMenu = useCallback((at?: "first" | "last") => {
    setQuery("");
    setActive(initialActive(options, values, at));
    setOpen(true);
  }, [options, values]);
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) triggerRef.current?.focus();
  }, [triggerRef]);
  const choose = (option: SelectOption | undefined) => {
    if (!option || option.disabled) return;
    if (multiple) return onValues(toggleValue(values, option.value));
    onValues([option.value]);
    close(true);
  };
  const changeQuery = (next: string) => {
    setQuery(next);
    setActive(moveActive(visualOrder(filterOptions(options, next)), -1, "Home"));
  };
  const ctx: KeyContext = { options, list, active, search, setActive, openMenu, close, choose, typed };
  const onKeyDown = (e: KeyboardEvent) => (open ? onOpenKey(e, ctx) : onClosedKey(e, ctx));
  const optionId = (i: number) => `${id}-opt-${i}`;
  const activeId = open && active >= 0 && active < list.length ? optionId(active) : undefined;
  return { id, open, openMenu, close, query, changeQuery, list, active, setActive, activeId, optionId, choose, onKeyDown, search };
}

// 바깥(칸·목록이 아닌 곳)을 누르면 닫는다. 포커스는 누른 곳으로 가게 두고 되돌리지 않는다
export function useOutsideClose(open: boolean, refs: RefObject<HTMLElement | null>[], close: (restore: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!refs.some((r) => r.current?.contains(e.target as Node))) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, refs, close]);
}
