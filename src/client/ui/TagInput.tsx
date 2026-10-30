import type { ClipboardEvent, KeyboardEvent } from "react";
import { useId, useState } from "react";
import { describedBy, Field, type FieldProps } from "./Field";
import { addTags } from "./format";
import { Icon } from "./icons";
import "./Form.css";
import "./TextField.css";
import "./TagInput.css";

type Props = FieldProps & {
  value: string[];
  onChange: (value: string[]) => void;
  id?: string;
  placeholder?: string;
  max?: number;
  required?: boolean;
  disabled?: boolean;
};

function TagChips({ tags, listLabel, onRemove }: { tags: string[]; listLabel: string; onRemove?: (tag: string) => void }) {
  return (
    <ul className="tag-list" aria-label={listLabel}>
      {tags.map((tag) => (
        <li key={tag} className="tag">
          <span>{tag}</span>
          {onRemove && (
            <button type="button" className="tag-remove" aria-label={`${tag} 지우기`} onClick={() => onRemove(tag)}>
              <Icon name="x" size={12} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// 칩 입력(키워드, 해시태그, 금지어). Enter·쉼표로 추가, 칩의 x 또는 빈 칸에서 Backspace 로 마지막 삭제.
// 칸을 벗어나면 친 글도 칩이 된다. 한글 조합 중 Enter 는 조합 확정이라 추가하지 않는다
export function TagInput({ label, hint, error, value, onChange, id, placeholder, max, required, disabled }: Props) {
  const auto = useId();
  const fid = id ?? auto;
  const [draft, setDraft] = useState("");
  const commit = (raw: string) => {
    const next = addTags(value, raw, max);
    if (next.length !== value.length) onChange(next);
    setDraft("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes(",")) return;
    e.preventDefault();
    commit(draft + text);
  };
  const full = max !== undefined && value.length >= max;
  return (
    <Field id={fid} label={label} hint={hint} error={error} required={required}>
      <div className={`control control-group tag-input ${disabled ? "is-disabled" : ""} ${error ? "is-invalid" : ""}`.trim()}>
        <TagChips tags={value} listLabel={label ? `${label} 목록` : "입력한 항목"} onRemove={disabled ? undefined : (tag) => onChange(value.filter((t) => t !== tag))} />
        <input
          id={fid} className="control-input tag-draft" value={draft} disabled={disabled || full} placeholder={full ? undefined : placeholder}
          aria-invalid={!!error} aria-describedby={describedBy(fid, { hint, error })}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} onBlur={() => draft.trim() && commit(draft)}
        />
      </div>
    </Field>
  );
}
