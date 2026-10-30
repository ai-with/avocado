import { useEffect, type KeyboardEvent } from "react";
import { Icon } from "./icons";
import { groupOptions, type SelectOption } from "./selectMenuLogic";

type Props = {
  listId: string;
  label: string;
  list: SelectOption[];
  values: string[];
  multiple: boolean;
  active: number;
  activeId?: string;
  optionId: (index: number) => string;
  onActive: (index: number) => void;
  onChoose: (option: SelectOption) => void;
  emptyText: string;
  /** 바텀시트에서 검색칸이 없을 때: 목록 자체가 포커스를 받아 키를 듣는다 */
  focusable?: boolean;
  onKeyDown?: (e: KeyboardEvent) => void;
};

// 선택 목록(role="listbox"). 포커스는 칸·검색칸에 두고 aria-activedescendant 로 활성 항목을 알린다
export function SelectMenuList({ listId, label, list, values, multiple, active, activeId, optionId, onActive, onChoose, emptyText, focusable, onKeyDown }: Props) {
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);
  return (
    <>
    {list.length === 0 && <p className="select-menu-empty" role="status">{emptyText}</p>}
    <div
      id={listId} role="listbox" aria-label={label} aria-multiselectable={multiple || undefined} className="select-menu-list"
      tabIndex={focusable ? 0 : -1} data-autofocus={focusable || undefined} aria-activedescendant={focusable ? activeId : undefined} onKeyDown={onKeyDown}
    >
      {groupOptions(list).map((group, g) => (
        <div key={group.label ?? `_${g}`} role={group.label ? "group" : "presentation"} aria-labelledby={group.label ? `${listId}-g${g}` : undefined} className="select-menu-group">
          {group.label && <div id={`${listId}-g${g}`} className="select-menu-group-label" role="presentation">{group.label}</div>}
          {group.items.map(({ option, index }) => (
            <OptionRow
              key={option.value} id={optionId(index)} option={option} multiple={multiple} selected={values.includes(option.value)} active={index === active}
              onPoint={() => onActive(index)} onChoose={() => onChoose(option)}
            />
          ))}
        </div>
      ))}
    </div>
    </>
  );
}

type RowProps = { id: string; option: SelectOption; multiple: boolean; selected: boolean; active: boolean; onPoint: () => void; onChoose: () => void };

function OptionRow({ id, option, multiple, selected, active, onPoint, onChoose }: RowProps) {
  const cls = ["select-menu-option", active && "is-active", selected && "is-selected", option.disabled && "is-disabled"].filter(Boolean).join(" ");
  return (
    // 누르는 동안 포커스가 칸·검색칸에서 떠나지 않게 mousedown 기본 동작을 막는다
    <div id={id} role="option" aria-selected={selected} aria-disabled={option.disabled || undefined} className={cls} onMouseMove={onPoint} onMouseDown={(e) => e.preventDefault()} onClick={onChoose}>
      <span className={multiple ? "select-menu-check is-box" : "select-menu-check"} aria-hidden="true">{selected && <Icon name="check" size={14} />}</span>
      <span className="select-menu-option-text">
        <span className="select-menu-option-label">{option.label}</span>
        {option.description && <span className="select-menu-option-desc">{option.description}</span>}
      </span>
    </div>
  );
}
