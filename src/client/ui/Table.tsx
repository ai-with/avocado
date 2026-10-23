import type { TableHTMLAttributes } from "react";
import { Icon, type IconName } from "./icons";
import "./Table.css";

export type TableColumn = { label: string; icon?: IconName; num?: boolean };
type Props = TableHTMLAttributes<HTMLTableElement> & { columns?: TableColumn[] };

// 사용: <Table><thead>...</thead><tbody>...</tbody></Table>
// 또는 columns 로 머리글(아이콘 포함)을 넘기고 children 에 <tbody> 만
export function Table({ className = "", columns, children, ...rest }: Props) {
  return (
    <div className="table-wrap">
      <table className={`table ${className}`} {...rest}>
        {columns && <TableHead columns={columns} />}
        {children}
      </table>
    </div>
  );
}

function TableHead({ columns }: { columns: TableColumn[] }) {
  return (
    <thead>
      <tr>
        {columns.map((c) => (
          <th key={c.label} scope="col" className={c.num ? "num" : undefined}>
            <span className="table-th-inner">
              {c.icon && <Icon name={c.icon} size={14} />}
              {c.label}
            </span>
          </th>
        ))}
      </tr>
    </thead>
  );
}
