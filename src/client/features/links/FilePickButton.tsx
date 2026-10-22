import { useRef } from "react";
import { Button } from "../../ui";

type Props = {
  label: string;
  accept: string;
  onFile: (file: File | undefined) => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
};

// 숨은 파일 입력을 여는 버튼. label 대신 button 이라 키보드로도 열린다
export function FilePickButton({ label, accept, onFile, disabled, variant = "secondary", size = "sm" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant={variant} size={size} disabled={disabled} onClick={() => inputRef.current?.click()}>{label}</Button>
      <input ref={inputRef} type="file" accept={accept} hidden disabled={disabled} onChange={(e) => onFile(e.target.files?.[0])} />
    </>
  );
}
