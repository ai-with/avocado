import type { ReactNode } from "react";
import { IconButton } from "./Button";
import { useDialog } from "./useDialog";
import "./Modal.css";

type Props = { open: boolean; title: string; description?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: "md" | "lg" };

export function Modal({ open, title, description, onClose, children, footer, size = "md" }: Props) {
  const ref = useDialog<HTMLDivElement>(open, onClose);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div className="grow">
            <h4>{title}</h4>
            {description && <p className="modal-description">{description}</p>}
          </div>
          <IconButton icon="x" label="닫기" size="sm" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
