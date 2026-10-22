import { useRef } from "react";
import { EditorContent, type Editor, type JSONContent } from "@tiptap/react";
import { useToast } from "../../ui";
import { errorMessage } from "../../lib/api";
import { uploadImage } from "../links/common";
import { useSlashEditor, useSlashMenu, type Menu, type SlashItem } from "./useBlockEditor";
import "./docs.css";

type Toast = ReturnType<typeof useToast>;

// 링크 메뉴: 주소와 보여 줄 글자를 차례로 묻는다
function insertLink(editor: Editor, toast: Toast) {
  const url = window.prompt("링크 주소 (https://...)")?.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) return toast("http 또는 https 로 시작하는 주소를 넣어 주세요.", "danger");
  const text = window.prompt("보여 줄 글자 (비우면 주소 그대로)")?.trim() || url;
  editor.chain().focus().insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href: url } }] }).insertContent(" ").run();
}

// 이미지 메뉴: 올린 뒤 커서 자리에 넣고, 같은 파일을 다시 고를 수 있게 입력칸을 비운다
async function insertImage(file: File | undefined, editor: Editor | null, input: HTMLInputElement | null, toast: Toast) {
  if (!file || !editor) return;
  try {
    const { url } = await uploadImage(file);
    editor.chain().focus().setImage({ src: url, alt: file.name }).run();
  } catch (e) {
    toast(errorMessage(e), "danger");
  } finally {
    if (input) input.value = "";
  }
}

function SlashMenu({ menu, items, onPick }: { menu: Menu; items: SlashItem[]; onPick: (it: SlashItem) => void }) {
  return (
    <div className="slash-menu" role="listbox" aria-label="블록 고르기" style={{ top: menu.top, left: menu.left }}>
      {items.map((it, i) => (
        <button
          key={it.label}
          type="button"
          role="option"
          aria-selected={i === menu.index}
          className={i === menu.index ? "active" : ""}
          onMouseDown={(e) => (e.preventDefault(), onPick(it))}
        >
          <b>{it.label}</b>
          <span>{it.hint}</span>
        </button>
      ))}
    </div>
  );
}

export function BlockEditor({ content, onChange }: { content: JSONContent; onChange: (json: JSONContent, html: string) => void }) {
  const toast = useToast();
  const slash = useSlashMenu();
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);

  const pick = (item: SlashItem) => {
    const m = slash.menuRef.current;
    const editor = editorRef.current;
    if (!editor || !m) return;
    editor.chain().focus().deleteRange({ from: m.from, to: m.to }).run();
    slash.setMenu(null);
    if (item.label === "이미지") return fileRef.current?.click();
    if (item.label === "링크") return insertLink(editor, toast);
    item.run(editor);
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const editor = useSlashEditor({ content, onChange, slash, boxRef, pickRef });
  editorRef.current = editor;

  const onImage = (file: File | undefined) => insertImage(file, editor, fileRef.current, toast);

  return (
    <div className="block-editor" ref={boxRef}>
      <EditorContent editor={editor} className="doc-prose" />
      {slash.menu && slash.items.length > 0 && <SlashMenu menu={slash.menu} items={slash.items} onPick={pick} />}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden aria-label="이미지 파일" onChange={(e) => void onImage(e.target.files?.[0])} />
    </div>
  );
}
