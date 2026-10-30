import { useState } from "react";
import { Button, Checkbox, Modal, useToast, SelectMenu } from "../../../ui";
import { api, errorMessage } from "../../../lib/api";
import { parseCsv } from "../../../../shared/csv";
import { FilePickButton } from "../../links/FilePickButton";

const IMPORT_COLUMNS = [
  { key: "email", label: "이메일 (필수)", guess: /e-?mail|이메일|메일/i },
  { key: "name", label: "이름", guess: /name|이름|성명/i },
  { key: "company", label: "소속", guess: /company|소속|회사/i },
  { key: "phone", label: "전화번호", guess: /phone|tel|전화|연락처|휴대/i },
  { key: "marketing_opt_in", label: "마케팅 동의", guess: /marketing|opt|동의|수신/i },
] as const;
type ColKey = (typeof IMPORT_COLUMNS)[number]["key"];
type ColumnMap = Record<ColKey, number>;
const BATCH_SIZE = 100;
const UNMAPPED: ColumnMap = { email: -1, name: -1, company: -1, phone: -1, marketing_opt_in: -1 };

// 서버 한도에 맞춰 100행씩 나눠 올리고 결과를 합친다
async function uploadRows(rows: string[][], map: ColumnMap, consent: boolean) {
  const data = rows.slice(1).map((r) => Object.fromEntries(IMPORT_COLUMNS.filter((c) => map[c.key] >= 0).map((c) => [c.key, r[map[c.key]] ?? ""])));
  let imported = 0;
  let invalid = 0;
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const r = await api.post<{ imported: number; invalid: number[] }>("/leads/import", { consentConfirmed: consent, rows: data.slice(i, i + BATCH_SIZE) });
    imported += r.imported;
    invalid += r.invalid.length;
  }
  return { imported, invalid };
}

// CSV 가져오기: 열 매핑 + '수신 동의를 받은 연락처만 올린다' 확인 체크
export function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<ColumnMap>(UNMAPPED);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const header = rows[0] ?? [];

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseCsv(await file.text());
    setRows(parsed);
    const h = parsed[0] ?? [];
    setMap(Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, h.findIndex((x) => c.guess.test(x))])) as ColumnMap);
  };
  const run = async () => {
    setBusy(true);
    try {
      const { imported, invalid } = await uploadRows(rows, map, consent);
      toast(`${imported}명을 가져왔어요.${invalid ? ` 이메일 형식이 아닌 ${invalid}행은 건너뛰었어요.` : ""}`, "success");
      onDone();
      onClose();
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(false);
    }
  };
  const footer = <Button disabled={!consent || map.email < 0 || rows.length < 2} loading={busy} onClick={() => void run()}>{`${Math.max(0, rows.length - 1)}행 가져오기`}</Button>;
  return (
    <Modal open title="CSV 가져오기" onClose={onClose} footer={footer}>
      <div className="stack">
        <div><FilePickButton label="CSV 파일 고르기" accept=".csv,text/csv" onFile={(f) => void pick(f)} /></div>
        {header.length > 0 && <ColumnMapping header={header} map={map} onChange={setMap} />}
        <p className="text-caption">마케팅 동의 열이 없거나 값이 Y, 동의, true가 아니면 '동의 없음'으로 넣어요. 같은 이메일은 기존 리드에 합쳐요.</p>
        <Checkbox label="수신 동의를 받은 연락처만 올려요" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
      </div>
    </Modal>
  );
}

const SKIP_COLUMN = -1;

function ColumnMapping({ header, map, onChange }: { header: string[]; map: ColumnMap; onChange: (m: ColumnMap) => void }) {
  const options = [{ value: String(SKIP_COLUMN), label: "가져오지 않기" }, ...header.map((h, i) => ({ value: String(i), label: h || `${i + 1}번째 열` }))];
  return IMPORT_COLUMNS.map((c) => (
    <SelectMenu key={c.key} label={c.label} options={options} value={String(map[c.key])} onChange={(v) => onChange({ ...map, [c.key]: Number(v ?? SKIP_COLUMN) })} />
  ));
}
