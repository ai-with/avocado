import { Button, Modal } from "../../ui";
import { channelLabel } from "../../../shared/leads";
import { ContentNameSection, LinkSummary, OgCardSection, UtmSection } from "./sections/LinkDetailSections";
import { useLinkDetail } from "./useLinkDetail";
import type { Channel, LinkRow } from "./common";

type Props = { link: LinkRow; channels: Channel[]; onClose: () => void; onChanged: () => void };

// 링크 한 칸의 상세: 복사, QR 내려받기, 미리보기 카드, UTM(펼쳐서 수정), 삭제
export function LinkDetailModal({ link, channels, onClose, onChanged }: Props) {
  const s = useLinkDetail(link, onClose, onChanged);
  return (
    <Modal open title={[link.influencerName ?? "가이드 공용", channelLabel(link.channelKey, channels), link.contentLabel].filter(Boolean).join(" · ")} onClose={onClose}>
      <div className="stack">
        <LinkSummary link={link} s={s} />
        {link.contentKey && <ContentNameSection link={link} s={s} />}
        <OgCardSection s={s} />
        <UtmSection link={link} s={s} />
        <div><Button size="sm" variant="danger" onClick={() => void s.remove()}>링크 삭제</Button></div>
      </div>
    </Modal>
  );
}
