import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Modal, ProgressBar, SelectMenu, useToast } from "../../../ui";
import { ApiError, errorMessage } from "../../../lib/api";
import { FilePickButton } from "../../links/FilePickButton";
import { cancelImport, fileFingerprint, getExistingImport, getImportContext, IMPORT_COLUMNS, mappedRows, readImportFile, resolveImport, UNMAPPED, uploadImport, type ColumnMap, type SelectedImport } from "../import-upload";
import type { ImportContext, ImportJob } from "../../../../shared/lead-imports";

export function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [selected, setSelected] = useState<SelectedImport | null>(null), [map, setMap] = useState<ColumnMap>(UNMAPPED);
  const [context, setContext] = useState<ImportContext | null>(null), [job, setJob] = useState<ImportJob | null>(null);
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const lock = useRef(false), stop = useRef(false), closeAfter = useRef(false), current = useRef<ImportJob | null>(null), mounted = useRef(true), fileRequest = useRef(0);
  useEffect(() => {
    mounted.current = true;
    void getImportContext().then((value) => { if (mounted.current) setContext(value); }).catch((error: unknown) => { if (mounted.current) setNotice(errorMessage(error)); });
    return () => { mounted.current = false; stop.current = true; };
  }, []);
  const progress = (value: ImportJob) => { current.current = value; if (mounted.current) { setJob(value); if (value.status !== "active") setConsent(false); } };
  const pick = async (file?: File) => {
    if (!file || lock.current) return;
    const request = ++fileRequest.current;
    setSelected(null); setJob(null); current.current = null; setConsent(false); setMap(UNMAPPED);
    try {
      const value = await readImportFile(file);
      if (!mounted.current || request !== fileRequest.current) return;
      setSelected(value); setNotice("");
      setMap(Object.fromEntries(IMPORT_COLUMNS.map((column) => [column.key, value.rows[0]!.findIndex((name) => column.guess.test(name))])) as ColumnMap);
    } catch (error) { if (mounted.current && request === fileRequest.current) setNotice(errorMessage(error)); }
  };
  const run = async (fresh = false) => {
    if (!consent || !selected || map.email < 0 || !context || lock.current) return;
    lock.current = true; stop.current = false; closeAfter.current = false; setBusy(true); setNotice("");
    let cancellationStarted = false;
    try {
      const latestContext = await getImportContext();
      if (stop.current) return;
      if (latestContext.scope !== context.scope) throw new Error("로그인이나 워크스페이스가 바뀌었어요. 화면을 다시 열어 주세요.");
      const fingerprint = await fileFingerprint(selected, map);
      if (stop.current) return;
      let value = await resolveImport(latestContext, fingerprint, selected.rows.length - 1, consent, fresh);
      progress(value);
      value = await uploadImport(value, mappedRows(selected.rows, map), latestContext, consent, progress, () => stop.current);
      if (stop.current && value.status === "active") { cancellationStarted = true; progress(await cancelImport(value, latestContext)); }
      if (value.processed) onDone();
      if (value.status === "completed" && mounted.current) toast(`${value.imported}행을 가져왔어요.${value.invalid ? ` 이메일 형식이 아닌 ${value.invalid}행은 건너뛰었어요.` : ""}${value.skipped ? ` 새로 등록된 연락처 ${value.skipped}행은 덮지 않았어요.` : ""}`, "success");
    } catch (error) {
      if (mounted.current) setNotice(errorMessage(error));
      if (stop.current && !cancellationStarted && current.current?.status === "active") {
        try { progress(await cancelImport(current.current, context)); } catch { /* No contact retry; keep the original intent on unknown cancellation. */ }
      }
      if (error instanceof ApiError && [409, 410].includes(error.status) && current.current) {
        try { progress(await getExistingImport(current.current.id)); } catch { /* Keep the original intent on an unknown read. */ }
      }
      if (current.current?.processed) onDone();
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
      if (closeAfter.current) onClose();
    }
  };
  const requestClose = () => {
    if (!lock.current) { onClose(); return; }
    stop.current = true; closeAfter.current = true; setNotice("진행 중인 묶음을 확인한 뒤 중단해요. 완료된 행은 유지돼요.");
  };
  const cancel = async () => {
    if (lock.current) { stop.current = true; setNotice("현재 묶음 뒤에서 중단해요. 완료된 행은 유지돼요."); return; }
    if (!current.current || !context) return;
    try { progress(await cancelImport(current.current, context)); }
    catch (error) { setNotice(errorMessage(error)); }
  };
  const terminal = job && ["blocked", "expired", "cancelled", "completed"].includes(job.status);
  const footer = busy ? <Button variant="secondary" onClick={() => void cancel()}>현재 묶음 뒤 중단</Button> : terminal
    ? <Button disabled={!consent || !context || !selected || map.email < 0} onClick={() => void run(true)}>동의를 다시 확인하고 새 작업 시작</Button>
    : <Button disabled={!consent || !context || !selected || map.email < 0} onClick={() => void run()}>{job?.processed ? "같은 파일로 이어서 가져오기" : "가져오기 · 완료된 묶음 확인"}</Button>;
  return <Modal open title="CSV 가져오기" onClose={requestClose} footer={footer}>
    <div className="stack">
      <FilePickButton label="CSV 파일 고르기" accept=".csv,text/csv" disabled={busy} onFile={(file) => void pick(file)} />
      {selected && <ColumnMapping header={selected.rows[0]!} map={map} disabled={busy || !!job} onChange={setMap} />}
      <p className="text-caption">마케팅 동의 열이 없거나 동의로 읽히지 않으면 '동의 없음'으로 넣어요. 같은 이메일은 기존 리드에 합쳐요.</p>
      <Checkbox label="수신 동의를 받은 연락처만 올려요" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />
      <p className="text-caption">원본 CSV는 서버에 저장하지 않아요. 24시간 안에 같은 파일과 열 매핑을 다시 선택하면 완료된 묶음을 확인하고 이어가요.</p>
      {job && <div className="stack-tight" aria-live="polite"><ProgressBar label="가져오기 진행" value={job.processed / job.totalRows} showValue /><p>{job.processed} / {job.totalRows}행 처리 · 가져옴 {job.imported} · 잘못된 이메일 {job.invalid} · 새 등록 보호 {job.skipped}</p></div>}
      {job?.status === "blocked" && <p role="status">리드 삭제 상태가 바뀌어 중단했어요. 다른 연락처의 삭제도 이전 작업을 중단할 수 있어요. 완료된 행은 유지돼요.</p>}
      {job?.status === "expired" && <p role="status">24시간 재개 기한이 지났어요. 완료된 행은 유지돼요.</p>}
      {job?.status === "cancelled" && <p role="status">가져오기를 중단했어요. 완료된 행은 유지돼요.</p>}
      {notice && <p role="alert">{notice}</p>}
      {job?.status === "active" && !busy && <Button variant="secondary" onClick={() => void cancel()}>남은 가져오기 취소</Button>}
    </div>
  </Modal>;
}
function ColumnMapping({ header, map, onChange, disabled }: { header: string[]; map: ColumnMap; onChange: (value: ColumnMap) => void; disabled: boolean }) {
  const options = [{ value: "-1", label: "가져오지 않기" }, ...header.map((name, index) => ({ value: String(index), label: name || `${index + 1}번째 열` }))];
  return IMPORT_COLUMNS.map((column) => <SelectMenu key={column.key} label={column.label} options={options} value={String(map[column.key])} disabled={disabled} onChange={(value) => onChange({ ...map, [column.key]: Number(value ?? -1) })} />);
}
