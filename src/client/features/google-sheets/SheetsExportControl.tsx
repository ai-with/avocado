import { Button, ButtonAnchor, LoadingState, Modal } from "../../ui";
import { sheetsFileUrl, type SheetsJob, type SheetsKind } from "./types";
import { useSheetsExport } from "./useSheetsExport";

function JobResult({ job }: { job: SheetsJob }) {
  const url = sheetsFileUrl(job.spreadsheetUrl);
  if (job.status === "done") return <div className="stack-tight" role="status"><p>시트에 {job.rows.toLocaleString("ko-KR")}개 행을 저장했어요.</p>{url && <ButtonAnchor href={url} target="_blank" rel="noreferrer">시트 열기</ButtonAnchor>}</div>;
  if (job.status === "unknown") return <div className="stack-tight" role="status"><p>시트 생성 결과를 확인하지 못했어요. 중복 생성을 막기 위해 같은 요청으로 새 파일을 만들지 않아요.</p><ButtonAnchor href="https://drive.google.com/drive/my-drive" target="_blank" rel="noreferrer">Google Drive에서 확인</ButtonAnchor></div>;
  if (job.status === "failed") return <div className="stack-tight"><p className="text-danger" role="alert">{job.retryable ? "시트에 데이터를 쓰지 못했어요. 같은 시트에 다시 저장할 수 있어요." : "내보내기를 마치지 못했어요. 연결 상태와 내보낼 목록을 확인해 주세요."}</p>{url && <ButtonAnchor href={url} target="_blank" rel="noreferrer">만들어진 시트 확인</ButtonAnchor>}</div>;
  if (job.status === "cancelled") return <div className="stack-tight"><p className="text-caption" role="status">이 내보내기는 취소됐거나 만료됐어요. 연결 상태를 확인해 주세요.</p>{url && <ButtonAnchor href={url} target="_blank" rel="noreferrer">만들어진 시트 확인</ButtonAnchor>}</div>;
  return <p className="text-caption" role="status">시트를 만들고 있어요. 결과를 다시 확인해 주세요.</p>;
}

export function SheetsExportControl({ kind, query }: { kind: SheetsKind; query: string }) {
  const state = useSheetsExport(kind, query);
  const { connection, job, busy } = state;
  const pending = job && ["prepared", "creating", "writing"].includes(job.status);
  const ready = connection?.configured && connection.connected && Boolean(connection.generation);
  return <>
    <Button variant="ghost" size="sm" onClick={() => { state.setOpen(true); void state.refresh(); }}>구글 시트 내보내기</Button>
    <Modal open={state.open} title="구글 시트 내보내기" description="현재 필터의 목록을 내 Google Drive에 나만 볼 수 있는 새 시트로 저장해요." onClose={() => { if (!busy) state.setOpen(false); }}>
      <div className="stack">
        {state.loading ? <LoadingState lines={2} label="Google 연결 상태 확인 중" /> : <>
          {connection && !connection.configured && <p className="text-secondary">Google 연결을 준비하고 있어요. 지금은 CSV 내보내기를 이용해 주세요.</p>}
          {connection?.connected && <div className="row row-between row-wrap"><p className="text-secondary">연결된 Google 계정{connection.accountEmail ? `: ${connection.accountEmail}` : ""}</p><Button variant="ghost" size="sm" disabled={busy} onClick={() => void state.disconnect()}>연결 해제</Button></div>}
          {connection && <p className="text-caption">한 번에 최대 {connection.maxRows.toLocaleString("ko-KR")}개 행을 내보낼 수 있어요.</p>}
          {job && <JobResult job={job} />}
          {state.error && <p className="text-danger" role="alert">{state.error}</p>}
          <div className="row row-end row-wrap">
            <Button variant="ghost" disabled={busy} onClick={() => state.setOpen(false)}>닫기</Button>
            {!connection && <Button variant="secondary" loading={busy} onClick={() => void state.refresh()}>연결 상태 다시 확인</Button>}
            {connection && !ready && <Button disabled={!connection.configured || busy} loading={busy} onClick={() => void state.connect()}>Google 계정 연결</Button>}
            {ready && pending && <Button loading={busy} onClick={() => void state.check()}>결과 확인</Button>}
            {ready && job?.status === "unknown" && <Button variant="secondary" loading={busy} onClick={() => void state.check()}>결과 다시 확인</Button>}
            {ready && job?.status === "done" && <Button variant="secondary" loading={busy} onClick={() => void state.exportRows(true)}>새 시트로 다시 내보내기</Button>}
            {ready && (job?.status === "cancelled" || (job?.status === "failed" && !job.retryable)) && <Button variant="secondary" loading={busy} onClick={() => void state.exportRows(true)}>새 요청으로 내보내기</Button>}
            {ready && (!job || (job.status === "failed" && job.retryable)) && <Button loading={busy} onClick={() => void state.exportRows()}>{job ? "같은 시트에 다시 저장" : "시트 만들기"}</Button>}
          </div>
        </>}
      </div>
    </Modal>
  </>;
}
