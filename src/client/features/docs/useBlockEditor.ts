import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Link } from "@tiptap/extension-link";
import { Image } from "@tiptap/extension-image";

export type SlashItem = { label: string; hint: string; keys: string; run: (e: Editor) => void };
export type Menu = { from: number; to: number; query: string; top: number; left: number; index: number };
type SetMenu = Dispatch<SetStateAction<Menu | null>>;

// 노션처럼 빈 줄이나 띄어쓰기 뒤에 / 를 치면 블록 메뉴가 뜬다
export const SLASH_ITEMS: SlashItem[] = [
  { label: "제목 1", hint: "큰 제목", keys: "제목1 h1 heading", run: (e) => e.chain().focus().setNode("heading", { level: 1 }).run() },
  { label: "제목 2", hint: "중간 제목", keys: "제목2 h2 heading", run: (e) => e.chain().focus().setNode("heading", { level: 2 }).run() },
  { label: "제목 3", hint: "작은 제목", keys: "제목3 h3 heading", run: (e) => e.chain().focus().setNode("heading", { level: 3 }).run() },
  { label: "글머리 목록", hint: "• 항목", keys: "글머리 목록 bullet list", run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "번호 목록", hint: "1. 항목", keys: "번호 목록 number ordered list", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: "인용", hint: "인용문", keys: "인용 quote", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: "구분선", hint: "가로줄", keys: "구분선 divider hr", run: (e) => e.chain().focus().setHorizontalRule().run() },
  { label: "이미지", hint: "PNG, JPG, WEBP, GIF", keys: "이미지 사진 image", run: () => undefined },
  { label: "링크", hint: "주소 넣기", keys: "링크 link url", run: () => undefined },
];

const MENU_OFFSET_PX = 4;

// 커서 앞 글자가 '/검색어' 이고 그 앞이 줄 처음이나 공백이면 메뉴를 연다
function detectSlash(e: Editor, box: HTMLDivElement | null, setMenu: SetMenu) {
  const { $from, empty } = e.state.selection;
  if (!empty) return setMenu(null);
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const m = /(^|\s)\/([^\s/]{0,12})$/.exec(before);
  if (!m) return setMenu(null);
  const from = $from.pos - m[2]!.length - 1;
  const coords = e.view.coordsAtPos(from);
  const rect = box?.getBoundingClientRect();
  setMenu((prev) => ({ from, to: $from.pos, query: m[2]!, top: coords.bottom - (rect?.top ?? 0) + MENU_OFFSET_PX, left: coords.left - (rect?.left ?? 0), index: prev && prev.query === m[2] ? prev.index : 0 }));
}

// 메뉴가 열려 있을 때 위아래·Enter·Esc 를 가로챈다. 가로챘으면 true
function handleMenuKey(event: KeyboardEvent, m: Menu | null, list: SlashItem[], setMenu: SetMenu, pick: (item: SlashItem) => void) {
  if (!m || list.length === 0) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const d = event.key === "ArrowDown" ? 1 : -1;
    setMenu({ ...m, index: (m.index + d + list.length) % list.length });
    return true;
  }
  if (event.key === "Enter") {
    pick(list[m.index]!);
    return true;
  }
  if (event.key === "Escape") {
    setMenu(null);
    return true;
  }
  return false;
}

// 메뉴 상태. useEditor 의 콜백은 처음 만든 것을 계속 쓰므로 바뀌는 값은 ref 로 읽는다
export function useSlashMenu() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef<Menu | null>(null);
  menuRef.current = menu;
  const items = menu ? SLASH_ITEMS.filter((i) => !menu.query || i.keys.includes(menu.query.toLowerCase()) || i.label.includes(menu.query)) : [];
  const itemsRef = useRef(items);
  itemsRef.current = items;
  return { menu, setMenu, menuRef, items, itemsRef };
}

type SlashMenuState = ReturnType<typeof useSlashMenu>;
type EditorArgs = { content: JSONContent; onChange: (json: JSONContent, html: string) => void; slash: SlashMenuState; boxRef: RefObject<HTMLDivElement | null>; pickRef: RefObject<(item: SlashItem) => void> };

export function useSlashEditor({ content, onChange, slash, boxRef, pickRef }: EditorArgs) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const detect = (e: Editor) => detectSlash(e, boxRef.current, slash.setMenu);
  return useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false, protocols: ["https", "http", "mailto"] }),
      Image,
      Placeholder.configure({ placeholder: "내용을 쓰거나 / 를 눌러 블록을 고르세요" }),
    ],
    content,
    onUpdate: ({ editor: e }) => {
      onChangeRef.current(e.getJSON(), e.getHTML());
      detect(e);
    },
    onSelectionUpdate: ({ editor: e }) => detect(e),
    editorProps: {
      handleKeyDown: (_view, event) => handleMenuKey(event, slash.menuRef.current, slash.itemsRef.current, slash.setMenu, (item) => pickRef.current(item)),
    },
  });
}
