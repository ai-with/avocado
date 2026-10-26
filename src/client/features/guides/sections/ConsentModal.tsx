import { useEffect, useState } from "react";
import { Modal } from "../../../ui";
import { api } from "../../../lib/api";
import { countryName } from "../../../lib/countries";
import { fmtDateTime, type GuideInfluencerRow } from "../types";

type ConsentRow = { id: string; docVersion: string; agreedAt: number; withdrawnAt: number | null; name: string; email: string; country: string; items: Record<string, boolean>; secondaryUseScope: { ads: boolean; media: string[]; regions: string[]; months: number } };

function ConsentDetail({ c }: { c: ConsentRow }) {
  const scope = c.secondaryUseScope;
  return (
    <dl className="kv">
      <dt>동의 문서 버전</dt><dd>{c.docVersion}</dd>
      <dt>동의 시각</dt><dd>{fmtDateTime(c.agreedAt)}</dd>
      {c.withdrawnAt && (<><dt>철회 시각</dt><dd>{fmtDateTime(c.withdrawnAt)}</dd></>)}
      <dt>이름 · 이메일</dt><dd>{c.name} · {c.email}</dd>
      <dt>국가</dt><dd>{countryName(c.country)}</dd>
      <dt>2차 활용 동의</dt><dd>{c.items.secondary_use ? "동의" : "동의 안 함"}</dd>
      <dt>2차 활용 범위</dt>
      <dd>광고 {scope.ads ? "포함" : "제외"} · 매체 {scope.media.join(", ") || "없음"} · 지역 {scope.regions.join(", ") || "없음"} · {scope.months}개월</dd>
    </dl>
  );
}

export function ConsentModal({ row, base, onClose }: { row: GuideInfluencerRow | null; base: string; onClose: () => void }) {
  const [list, setList] = useState<ConsentRow[]>([]);
  useEffect(() => {
    if (row) void api.get<{ consents: ConsentRow[] }>(`${base}/${row.id}/consents`).then((d) => setList(d.consents));
  }, [row, base]);
  return (
    <Modal open={row !== null} title={`${row?.influencer.displayName ?? ""}님 동의 내용`} onClose={onClose}>
      <div className="stack">
        {list.map((c) => <ConsentDetail key={c.id} c={c} />)}
      </div>
    </Modal>
  );
}
