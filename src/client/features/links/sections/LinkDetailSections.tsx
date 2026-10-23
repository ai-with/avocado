import { useState } from "react";
import { Button, CopyButton, Input } from "../../../ui";
import type { Utm } from "../../../../shared/leads";
import { FilePickButton } from "../FilePickButton";
import type { LinkRow } from "../common";
import type { LinkDetailState } from "../useLinkDetail";

const UTM_KEYS: (keyof Utm)[] = ["source", "medium", "campaign", "content", "term"];
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export function LinkSummary({ link, s }: { link: LinkRow; s: LinkDetailState }) {
  return (
    <div className="row row-start">
      {s.qr && <img src={s.qr} alt={`${link.url} 로 가는 QR 코드`} width={120} height={120} />}
      <div className="stack-tight grow">
        <span className="lt-mono">{link.url}</span>
        <div className="row row-wrap">
          <CopyButton text={link.url} label="링크 복사" variant="secondary" />
          <Button size="sm" variant="secondary" onClick={s.downloadQr} disabled={!s.qr}>QR 내려받기</Button>
        </div>
        <span className="text-caption">클릭 {link.stats.clicks} · 열람 {link.stats.views} · 리드 {link.stats.leads}</span>
      </div>
    </div>
  );
}

export function OgCardSection({ s }: { s: LinkDetailState }) {
  const { og, setOg } = s;
  return (
    <section className="stack">
      <div className="stack-tight">
        <h4>미리보기 카드</h4>
        <p className="text-caption">카카오톡·슬랙 같은 메신저에 링크를 붙였을 때 보이는 카드예요. 이미지는 1200×630을 권해요.</p>
      </div>
      <Input label="제목" value={og.title ?? ""} maxLength={100} onChange={(e) => setOg({ ...og, title: e.target.value })} />
      <Input label="설명" value={og.description ?? ""} maxLength={200} onChange={(e) => setOg({ ...og, description: e.target.value })} />
      <div className="row">
        {og.imageKey && <img className="lt-og-thumb" src={`/api/public/asset/${og.imageKey}`} alt="미리보기 카드 이미지" />}
        <FilePickButton label={og.imageKey ? "이미지 바꾸기" : "이미지 고르기"} accept={IMAGE_ACCEPT} onFile={(f) => void s.pickImage(f)} />
      </div>
      <div><Button size="sm" variant="secondary" onClick={() => void s.save({ og }, "미리보기 카드를 저장했어요.")}>카드 저장</Button></div>
    </section>
  );
}

export function UtmSection({ link, s }: { link: LinkRow; s: LinkDetailState }) {
  const [showUtm, setShowUtm] = useState(false);
  const { utm, setUtm } = s;
  return (
    <section className="stack-tight">
      <div><Button size="sm" variant="ghost" aria-expanded={showUtm} onClick={() => setShowUtm(!showUtm)}>{showUtm ? "UTM 접기" : "UTM 펼치기"}</Button></div>
      {showUtm && (
        <>
          {link.destinationType !== "url" && <p className="text-caption">우리 자료·폼으로 가는 링크는 UTM 대신 링크 자체로 출처를 기록해요. 외부 주소로 바꾸면 이 값이 붙어요.</p>}
          {UTM_KEYS.map((k) => (
            <Input key={k} label={`utm_${k}`} value={utm[k]} onChange={(e) => setUtm({ ...utm, [k]: e.target.value })} />
          ))}
          <div><Button size="sm" variant="secondary" onClick={() => void s.save({ utm }, "UTM을 저장했어요.")}>UTM 저장</Button></div>
        </>
      )}
    </section>
  );
}
