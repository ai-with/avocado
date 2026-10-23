import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Icon, type IconName } from "./icons";
import "./Dropdown.css";

export type DropdownItem = {
  label: string;
  onSelect: () => void;
  icon?: IconName;
  /** 아이콘 대신 앞에 놓을 요소(워크스페이스 아바타 등) */
  leading?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** 이 항목 위에 구분선 */
  divider?: boolean;
};

type Props = {
  items: DropdownItem[];
  /** 트리거 버튼의 화면 낭독기 이름 */
  label: string;
  children: ReactNode;
  align?: "start" | "end";
  /** 사이드바 아래처럼 공간이 위에만 있으면 "top" */
  side?: "bottom" | "top";
  /** 목록 맨 위 안내 줄(이메일 등). 선택 항목이 아니다 */
  header?: ReactNode;
  triggerClassName?: string;
  /** 접힌 사이드바 툴팁 */
  tip?: string;
};

const MOVE: Record<string, (index: number, count: number) => number> = {
  ArrowDown: (i, n) => (i + 1) % n,
  ArrowUp: (i, n) => (i <= 0 ? n - 1 : i - 1),
  Home: () => 0,
  End: (_, n) => n - 1,
};
const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';

const menuItems = (menu: HTMLElement | null) => Array.from(menu?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR) ?? []);

// 바깥 클릭·Esc 로 닫고, 열리면 첫 항목으로 포커스를 옮긴다 (WAI-ARIA 메뉴 버튼 패턴)
function useMenuState(rootRef: RefObject<HTMLDivElement | null>, menuRef: RefObject<HTMLDivElement | null>, triggerRef: RefObject<HTMLButtonElement | null>) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    menuItems(menuRef.current)[0]?.focus();
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, rootRef, menuRef, triggerRef]);
  return [open, setOpen] as const;
}

export function Dropdown({ items, label, children, align = "start", side = "bottom", header, triggerClassName = "", tip }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useMenuState(rootRef, menuRef, triggerRef);

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    setOpen(true);
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") return setOpen(false);
    const move = MOVE[e.key];
    if (!move) return;
    e.preventDefault();
    const nodes = menuItems(menuRef.current);
    nodes[move(nodes.indexOf(document.activeElement as HTMLButtonElement), nodes.length)]?.focus();
  };
  const select = (item: DropdownItem) => {
    setOpen(false);
    triggerRef.current?.focus();
    item.onSelect();
  };

  return (
    <div className="dropdown" ref={rootRef}>
      <button ref={triggerRef} type="button" className={triggerClassName} aria-haspopup="menu" aria-expanded={open} aria-label={label} data-tip={tip} onClick={() => setOpen((v) => !v)} onKeyDown={onTriggerKey}>
        {children}
      </button>
      {open && (
        <div ref={menuRef} className={`dropdown-menu dropdown-${align} dropdown-${side}`} role="menu" aria-label={label} onKeyDown={onMenuKey}>
          {header && <div className="dropdown-header">{header}</div>}
          {items.map((item) => <DropdownRow key={item.label} item={item} onSelect={select} />)}
        </div>
      )}
    </div>
  );
}

function DropdownRow({ item, onSelect }: { item: DropdownItem; onSelect: (item: DropdownItem) => void }) {
  return (
    <>
      {item.divider && <div className="dropdown-divider" role="separator" />}
      <button type="button" role="menuitem" tabIndex={-1} className={`dropdown-item ${item.danger ? "is-danger" : ""}`} disabled={item.disabled} onClick={() => onSelect(item)}>
        {item.leading ?? (item.icon && <Icon name={item.icon} size={16} />)}
        <span className="truncate">{item.label}</span>
      </button>
    </>
  );
}
