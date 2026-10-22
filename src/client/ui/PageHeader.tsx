import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./icons";
import "./PageHeader.css";

type Props = { title: string; description?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } };

export function PageHeader({ title, description, actions, back }: Props) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {back && (
          <Link to={back.to} className="page-header-back">
            <Icon name="chevron-left" size={16} />
            {back.label}
          </Link>
        )}
        <h2>{title}</h2>
        {description && <p className="text-secondary">{description}</p>}
      </div>
      {actions && <div className="row page-header-actions">{actions}</div>}
    </header>
  );
}
