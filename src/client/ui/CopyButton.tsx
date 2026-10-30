import { Button } from "./Button";
import { useToast } from "./Toast";

type Props = { text: string; label?: string; doneMessage?: string; size?: "sm" | "md" | "lg" | "xl"; variant?: "secondary" | "ghost"; disabled?: boolean; "aria-label"?: string };

// 주소·코드 복사 버튼. 복사 결과를 토스트로 알린다
export function CopyButton({ text, label = "복사", doneMessage = "링크를 복사했어요.", size = "sm", variant = "secondary", disabled, "aria-label": ariaLabel }: Props) {
  const toast = useToast();
  const copy = () => void navigator.clipboard.writeText(text).then(() => toast(doneMessage, "success"));
  return <Button size={size} variant={variant} onClick={copy} disabled={disabled} aria-label={ariaLabel}>{label}</Button>;
}
