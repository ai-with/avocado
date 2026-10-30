import { Button, Checkbox, Modal, Spinner, Textarea } from "../../../ui";
import { fmtTimecode } from "../../../../shared/review";
import type { ReviewDetail } from "../types";
import { useSendPreview } from "./useSendPreview";

type Props = { open: boolean; d: ReviewDetail; base: string; onClose: () => void; onSent: () => Promise<void> };

// 전송 전 번역 미리보기 (필수). 번역문은 고칠 수 있고, 번역 실패 항목은 원문 전송 여부를 고른다
export function SendModal({ open, d, base, onClose, onSent }: Props) {
  const s = useSendPreview(open, base, onClose, onSent);
  const needs = d.influencer.lang !== "ko";
  const footer = (
    <div className="row row-end">
      <Button variant="ghost" onClick={onClose}>취소</Button>
      <Button onClick={() => void s.send()} disabled={!s.items || s.busy || (s.unresolved.length > 0 && !s.sendOriginal)}>피드백 보내기</Button>
    </div>
  );
  return (
    <Modal open={open} title="피드백 보내기 전 확인" onClose={onClose} size="lg" footer={footer}>
      {!s.items ? (
        <p className="row text-secondary" role="status"><Spinner size="sm" />{needs ? "번역하는 중이에요" : "불러오는 중이에요"}</p>
      ) : (
        <div className="stack">
          <p className="text-caption">{needs ? `${d.influencer.displayName}님에게 영어로 보내요. 번역문을 고칠 수 있어요.` : `${d.influencer.displayName}님에게 한국어 원문으로 보내요.`}</p>
          {s.items.map((it, i) => (
            <div key={it.id} className="stack-tight">
              <strong>{i + 1}. {fmtTimecode(it.tMs)}</strong>
              <p className="text-secondary">{it.text}</p>
              {needs && (
                <Textarea
                  aria-label={`${i + 1}번 번역문`}
                  value={s.edits[it.id] ?? it.textTranslated ?? ""}
                  onChange={(e) => s.setEdits({ ...s.edits, [it.id]: e.target.value })}
                  placeholder={s.failed.includes(it.id) ? "번역 실패. 직접 입력하거나 원문으로 보내세요" : ""}
                  hint="자동 번역"
                />
              )}
            </div>
          ))}
          {s.unresolved.length > 0 && <Checkbox label={`번역이 없는 ${s.unresolved.length}건은 한국어 원문으로 보내기`} checked={s.sendOriginal} onChange={(e) => s.setSendOriginal(e.target.checked)} />}
          <p className="text-caption">보내면 {d.rounds.length + 1}회차가 되고, 인플루언서에게 이메일과 피드백 링크로 전달돼요.</p>
        </div>
      )}
    </Modal>
  );
}
