import { useCallback, useMemo, useRef, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MOBILE_QUERY, useMediaQuery } from "../shell/useMediaQuery";
import { Button } from "./Button";
import { Drawer } from "./Drawer";
import { describedBy, Field, type FieldProps } from "./Field";
import { Icon } from "./icons";
import { summaryLabel, type SelectOption } from "./selectMenuLogic";
import { SelectMenuList } from "./SelectMenuList";
import type { ControlSize } from "./TextField";
import { usePopoverPosition } from "./usePopoverPosition";
import { useOutsideClose, useSelectMenu } from "./useSelectMenu";
import "./Form.css";
import "./TextField.css";
import "./SelectMenu.css";

type Base = FieldProps & {
  options: SelectOption[];
  placeholder?: string;
  /** sm: 표 안·줄 안(폭은 내용만큼), md: 기본, lg: 공개 화면 주 입력 */
  size?: ControlSize;
  disabled?: boolean;
  required?: boolean;
  /** 검색칸. 생략하면 선택지가 8개 이상일 때 자동으로 켠다 */
  searchable?: boolean;
  /** 값이 있을 때 칸 오른쪽 지우기 단추 */
  clearable?: boolean;
  emptyText?: string;
  searchPlaceholder?: string;
  id?: string;
  /** 칸(테두리 묶음)에 더할 클래스 */
  className?: string;
  /** 라벨을 보이지 않을 때(표 안) 화면 낭독기 이름 */
  "aria-label"?: string;
};
type SingleProps = Base & { multiple?: false; value: string | null; onChange: (value: string | null) => void };
type MultiProps = Base & { multiple: true; value: string[]; onChange: (value: string[]) => void; display?: "chips" | "count" };
export type SelectMenuProps = SingleProps | MultiProps;

const MAX_CHIPS = 2;
// 위치를 재기 전 첫 그림. visibility:hidden 이면 검색칸 autoFocus 가 먹지 않아 투명도로 숨긴다
const HIDDEN_UNTIL_PLACED = { position: "fixed", top: 0, left: 0, opacity: 0 } as const;
const SIZE_CLASS: Record<ControlSize, string> = { sm: "control-sm", md: "", lg: "control-lg" };

const valuesOf = (p: SelectMenuProps) => (p.multiple ? p.value : p.value === null ? [] : [p.value]);
const emit = (p: SelectMenuProps, next: string[]) => (p.multiple ? p.onChange(next) : p.onChange(next[0] ?? null));

// 선택 드롭다운(직접 그린 목록). 검색·설명 줄·묶음·비활성·다중 선택이 필요할 때 쓴다. option 자식으로 쓰는 단순 선택은 Select
// 목록은 body 에 fixed 로 붙어 표·모달 안에서도 잘리지 않고, 휴대폰 폭(599 이하)에서는 바텀시트로 열린다
export function SelectMenu(props: SelectMenuProps) {
  const { label, hint, error, size = "md", disabled, required, clearable, id } = props;
  const values = valuesOf(props);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const mobile = useMediaQuery(MOBILE_QUERY);
  const menu = useSelectMenu({ options: props.options, values, multiple: !!props.multiple, searchable: props.searchable, onValues: (next) => emit(props, next), triggerRef });
  const fid = id ?? `${menu.id}-trigger`;
  const listId = `${menu.id}-list`;
  const { close } = menu;
  const lost = useCallback(() => close(false), [close]);
  const insideRefs = useMemo(() => [rootRef, popRef], []);
  useOutsideClose(menu.open && !mobile, insideRefs, close);
  const placement = usePopoverPosition(menu.open && !mobile, rootRef, popRef, lost);
  const groupCls = ["control control-group select-menu", SIZE_CLASS[size], menu.open && "is-open", disabled && "is-disabled", error && "is-invalid", props.className].filter(Boolean).join(" ");
  const name = label ?? props["aria-label"] ?? "선택";
  return (
    <Field id={fid} label={label} hint={hint} error={error} required={required} fit={size === "sm"}>
      <div ref={rootRef} className={groupCls}>
        <button
          ref={triggerRef} id={fid} type="button" role="combobox" className="select-menu-trigger" disabled={disabled}
          aria-haspopup="listbox" aria-expanded={menu.open} aria-controls={menu.open ? listId : undefined} aria-label={label ? undefined : props["aria-label"]}
          aria-activedescendant={menu.open && !menu.search && !mobile ? menu.activeId : undefined} aria-invalid={!!error} aria-required={required || undefined}
          aria-describedby={describedBy(fid, { hint, error })} onClick={() => (menu.open ? menu.close(false) : menu.openMenu())} onKeyDown={menu.onKeyDown}
        >
          <TriggerValue props={props} values={values} />
        </button>
        {clearable && values.length > 0 && !disabled && <ClearButton onClear={() => { emit(props, []); triggerRef.current?.focus(); }} />}
        <span className="select-menu-chevron" aria-hidden="true"><Icon name="chevron-down" size={16} /></span>
      </div>
      {menu.open && createPortal(
        mobile ? <MenuSheet name={name} props={props} values={values} menu={menu} listId={listId} /> : <MenuPopup popRef={popRef} placement={placement} name={name} props={props} values={values} menu={menu} listId={listId} />,
        document.body,
      )}
    </Field>
  );
}

function ClearButton({ onClear }: { onClear: () => void }) {
  return (
    <button type="button" className="control-clear" aria-label="선택 지우기" onClick={onClear}>
      <Icon name="x" size={12} />
    </button>
  );
}

function TriggerValue({ props, values }: { props: SelectMenuProps; values: string[] }) {
  if (values.length === 0) return <span className="select-menu-placeholder">{props.placeholder ?? "선택해 주세요"}</span>;
  if (!props.multiple || props.display === "count" || values.length === 1) return <span className="truncate">{summaryLabel(props.options, values)}</span>;
  const shown = values.slice(0, MAX_CHIPS).map((v) => props.options.find((o) => o.value === v)?.label ?? v);
  return (
    <span className="select-menu-chips">
      {shown.map((text) => <span key={text} className="select-menu-chip">{text}</span>)}
      {values.length > MAX_CHIPS && <span className="select-menu-more">+{values.length - MAX_CHIPS}</span>}
    </span>
  );
}

type Menu = ReturnType<typeof useSelectMenu>;
type PartProps = { name: string; props: SelectMenuProps; values: string[]; menu: Menu; listId: string };

function MenuList({ name, props, values, menu, listId, focusable, onKeyDown }: PartProps & { focusable?: boolean; onKeyDown?: (e: KeyboardEvent) => void }) {
  return (
    <SelectMenuList
      listId={listId} label={name} list={menu.list} values={values} multiple={!!props.multiple} active={menu.active} activeId={menu.activeId}
      optionId={menu.optionId} onActive={menu.setActive} onChoose={menu.choose} emptyText={props.emptyText ?? "맞는 항목이 없어요"} focusable={focusable} onKeyDown={onKeyDown}
    />
  );
}

function SearchInput({ menu, listId, placeholder }: { menu: Menu; listId: string; placeholder?: string }) {
  return (
    <div className="select-menu-search">
      <Icon name="search" size={16} />
      <input
        className="control-input" type="search" role="combobox" aria-label="선택지 검색" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={menu.activeId} autoFocus data-autofocus value={menu.query} placeholder={placeholder ?? "검색"} onChange={(e) => menu.changeQuery(e.target.value)} onKeyDown={menu.onKeyDown}
      />
    </div>
  );
}

type PopupProps = PartProps & { popRef: RefObject<HTMLDivElement | null>; placement: ReturnType<typeof usePopoverPosition> };

function MenuPopup({ popRef, placement, ...part }: PopupProps) {
  return (
    <div ref={popRef} className="select-menu-pop" data-side={placement?.side} style={placement?.style ?? HIDDEN_UNTIL_PLACED}>
      {part.menu.search && <SearchInput menu={part.menu} listId={part.listId} placeholder={part.props.searchPlaceholder} />}
      <MenuList {...part} />
    </div>
  );
}

// 휴대폰: 바텀시트. 검색칸이 없으면 목록이 포커스를 받아 키를 듣는다. 다중 선택은 "완료"로 닫는다
function MenuSheet(part: PartProps) {
  const { menu } = part;
  return (
    <Drawer side="bottom" title={part.name} onClose={() => menu.close(true)}>
      <div className="select-menu-sheet">
        {menu.search && <SearchInput menu={menu} listId={part.listId} placeholder={part.props.searchPlaceholder} />}
        <MenuList {...part} focusable={!menu.search} onKeyDown={menu.search ? undefined : menu.onKeyDown} />
      </div>
      {part.props.multiple && <div className="select-menu-sheet-done"><Button size="lg" className="select-menu-done-button" onClick={() => menu.close(true)}>완료</Button></div>}
    </Drawer>
  );
}
