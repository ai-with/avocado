import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import "./Toast.css";

type Tone = "neutral" | "success" | "danger";
type Item = { id: number; text: string; tone: Tone };
const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

let seq = 0;
const TOAST_MS = 3500;
const TONE_ICON: Record<Tone, IconName | null> = { neutral: null, success: "circle-check", danger: "circle-alert" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const show = useCallback((text: string, tone: Tone = "neutral") => {
    const id = ++seq;
    setItems((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), TOAST_MS);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => <ToastItem key={i.id} item={i} />)}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ item }: { item: Item }) {
  const icon = TONE_ICON[item.tone];
  return (
    <div className={`toast toast-${item.tone}`} role={item.tone === "danger" ? "alert" : undefined}>
      {icon && <Icon name={icon} size={16} />}
      <span>{item.text}</span>
    </div>
  );
}

export const useToast = () => useContext(ToastContext);
