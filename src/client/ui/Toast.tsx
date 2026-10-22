import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import "./Toast.css";

type Tone = "neutral" | "success" | "danger";
type Item = { id: number; text: string; tone: Tone };
const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

let seq = 0;
const TOAST_MS = 3500;

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
        {items.map((i) => <div key={i.id} className={`toast toast-${i.tone}`} role={i.tone === "danger" ? "alert" : undefined}>{i.text}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
