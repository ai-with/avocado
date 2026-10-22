import type { TableHTMLAttributes } from "react";
import "./Table.css";

// 사용: <Table><thead>...</thead><tbody>...</tbody></Table>
export function Table({ className = "", ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="table-wrap">
      <table className={`table ${className}`} {...rest} />
    </div>
  );
}
