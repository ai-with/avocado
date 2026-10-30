import { useEffect, useState } from "react";
import { Button, Card, Checkbox, EmptyState, Input, LoadingState, Modal, Stat, StatGrid, TextField, useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { channelLabel, type DocumentGate } from "../../../shared/leads";
import { Bars } from "./LinkAnalytics";
import { GateTimingField } from "../docs/GateTimingField";
import { GateFieldsEditor } from "./sections/GateFieldsEditor";
import { LeadViewsTable } from "./sections/LeadViewsTable";
import { pct, seconds, ZERO_HINT, type Channel, type DocumentRow } from "./common";

const MS_PER_SECOND = 1000;
const toDateInput = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");
// 만료일은 한국 시간 그날 끝까지 열어 둔다
const fromDateInput = (v: string) => (v ? new Date(`${v}T23:59:59+09:00`).getTime() : null);

function useDocumentSettings(doc: Omit<DocumentRow, "stats">, onClose: () => void, onSaved: () => void) {
  const toast = useToast();
  const [title, setTitle] = useState(doc.title);
  const [allowDownload, setAllowDownload] = useState(doc.allowDownload);
  const [gate, setGate] = useState<DocumentGate>(doc.gate);
  const [blocked, setBlocked] = useState(doc.gate.blockedEmails.join("\n"));
  const g = (patch: Partial<DocumentGate>) => setGate((p) => ({ ...p, ...patch }));

  const save = async () => {
    try {
      const blockedEmails = blocked.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      await api.patch(`/documents/${doc.id}`, { title, allowDownload, gate: { ...gate, blockedEmails } });
      toast("자료 설정을 저장했어요.", "success");
      onSaved();
      onClose();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  return { title, setTitle, allowDownload, setAllowDownload, gate, g, blocked, setBlocked, save };
}

// 자료 설정: 제목, 내려받기 허용, 리드 게이트(위치, 받을 항목, 직접 질문, 회사 이메일만, 차단 목록, 열람 만료)
export function DocumentSettingsModal({ doc, onClose, onSaved }: { doc: Omit<DocumentRow, "stats">; onClose: () => void; onSaved: () => void }) {
  const s = useDocumentSettings(doc, onClose, onSaved);
  return (
    <Modal open title="자료 설정" onClose={onClose} footer={<Button onClick={() => void s.save()}>설정 저장</Button>}>
      <div className="stack">
        <Input label="제목" value={s.title} onChange={(e) => s.setTitle(e.target.value)} />
        {doc.sourceType === "pdf" && <Checkbox label="열람자가 PDF를 내려받을 수 있게 하기" checked={s.allowDownload} onChange={(e) => s.setAllowDownload(e.target.checked)} />}
        <h4>리드 게이트</h4>
        <GateTimingField gate={s.gate} onChange={s.g} />
        {s.gate.position !== "none" && <GateFieldsEditor gate={s.gate} g={s.g} blocked={s.blocked} setBlocked={s.setBlocked} />}
        <TextField label="열람 만료일" hint="비우면 계속 열려요." type="date" value={toDateInput(s.gate.expiresAt)} onChange={(e) => s.g({ expiresAt: fromDateInput(e.target.value) })} />
      </div>
    </Modal>
  );
}

type DocAnalytics = {
  pages: number;
  views: number;
  unique: number;
  reViews: number;
  completed: number;
  completionRate: number;
  avgScrollPct: number;
  pageStats: { page: number; viewers: number; avgDwellMs: number }[];
  byLink: { linkId: string | null; channelKey: string | null; influencerName: string | null; views: number; completed: number }[];
  leadViews: { leadId: string; email: string; name: string | null; maxPage: number; completed: boolean; startedAt: number }[];
};

function DwellCard({ pageStats }: { pageStats: DocAnalytics["pageStats"] }) {
  return (
    <Card className="stack">
      <span className="text-caption">페이지별 평균 체류 시간</span>
      {pageStats.length ? (
        <Bars rows={pageStats.map((p) => ({ label: `${p.page}페이지 · ${seconds(p.avgDwellMs)}`, value: Math.round(p.avgDwellMs / MS_PER_SECOND) }))} />
      ) : (
        <p className="text-secondary">열람자가 페이지를 넘기면 쌓여요.</p>
      )}
    </Card>
  );
}

// 자료 열람 집계: 열람 수, 완독률, 재열람, 페이지별 평균 체류, 유입(인플루언서·채널), 리드와 연결된 열람
export function DocumentAnalytics({ doc, channels }: { doc: DocumentRow; channels: Channel[] }) {
  const [a, setA] = useState<DocAnalytics | null>(null);
  useEffect(() => {
    void api.get<DocAnalytics>(`/documents/${doc.id}/analytics`).then(setA);
  }, [doc.id]);
  if (!a) return <LoadingState pattern="detail" />;
  if (a.views === 0) return <EmptyState compact title="아직 열람이 없어요" description={`이 자료를 목적지로 한 ${ZERO_HINT}.`} />;
  return (
    <div className="stack">
      <StatGrid>
        <Stat label="열람" value={a.views} />
        <Stat label="재열람" value={a.reViews} />
        <Stat label="완독률" value={pct(a.completionRate)} />
        <Stat label="평균 스크롤 깊이" value={`${a.avgScrollPct}%`} />
      </StatGrid>
      <DwellCard pageStats={a.pageStats} />
      <Card className="stack">
        <span className="text-caption">유입 (인플루언서 · 채널)</span>
        <Bars rows={a.byLink.map((l) => ({ label: `${l.influencerName ?? "가이드 공용"} · ${l.channelKey ? channelLabel(l.channelKey, channels) : "직접"}`, value: l.views }))} />
      </Card>
      <LeadViewsTable leadViews={a.leadViews} pages={a.pages} />
    </div>
  );
}
