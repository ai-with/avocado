import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge, Button, EmptyState, LoadingState, PageHeader, Table } from "../../ui";
import { api } from "../../lib/api";
import { fmtDate } from "./types";

type Row = { id: string; name: string; status: "draft" | "published"; createdAt: number; influencerCount: number; viewedCount: number; uploadCount: number };

export function GuidesListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => void api.get<{ guides: Row[] }>("/guides").then((d) => setRows(d.guides)), []);
  const create = <Button onClick={() => navigate("/guides/new")}>새 가이드 만들기</Button>;

  return (
    <>
      <PageHeader title="가이드" description="가이드 하나가 기본 단위예요. 인플루언서, 리드 링크, 검수, 성과를 가이드 안에서 봐요." actions={create} />
      {rows === null ? <LoadingState /> : rows.length === 0 ? (
        <EmptyState title="아직 가이드가 없어요" description="첫 가이드를 만들면 바로 공유 링크가 나와요." action={create} />
      ) : (
        <Table>
          <thead>
            <tr><th>이름</th><th>상태</th><th className="num">인플루언서</th><th className="num">열람</th><th className="num">업로드</th><th>만든 날짜</th></tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td><Link to={`/guides/${g.id}`}>{g.name}</Link></td>
                <td className="nowrap"><Badge tone={g.status === "published" ? "success" : "neutral"}>{g.status === "published" ? "공개" : "작성 중"}</Badge></td>
                <td className="num">{g.influencerCount}</td>
                <td className="num">{g.viewedCount}</td>
                <td className="num">{g.uploadCount}</td>
                <td className="nowrap">{fmtDate(g.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
