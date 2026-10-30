import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";
import "./Form.css";
import "./Selection.css";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role" | "onChange" | "checked"> & {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hideLabel?: boolean;
};

// 바로 반영되는 켜고 끄기(알림 받기, 공개 여부). 저장 버튼을 눌러야 반영되는 폼 안 선택은 Checkbox
// 네이티브 체크박스에 role="switch": Space 로 토글, aria-checked 는 브라우저가 맞춘다. 라벨에 "켜짐·꺼짐·스위치"를 넣지 않는다
export function Switch({ label, description, checked, onChange, hideLabel, className = "", ...rest }: Props) {
  const descId = useId();
  return (
    <label className={`switch-row ${className}`.trim()}>
      <span className={hideLabel ? "sr-only" : "checkbox-text"}>
        <span>{label}</span>
        {description && <span id={descId} className="checkbox-desc">{description}</span>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} aria-describedby={description ? descId : undefined} onChange={(e) => onChange(e.target.checked)} {...rest} />
    </label>
  );
}
