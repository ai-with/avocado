import { useState } from "react";
import { Button, Drawer, Modal, useToast } from "../../../ui";
import { Group, Specimen } from "../Showcase";

type Open = "dialog" | "modal" | "modal-lg" | "drawer" | "sheet" | null;

export function Overlays() {
  const [open, setOpen] = useState<Open>(null);
  const toast = useToast();
  const close = () => setOpen(null);
  return (
    <Group title="Modal, Drawer, Toast" note="눌러서 연다. 다이얼로그는 아래에서 떠오르며, 바텀시트는 아래에서 올라오며, 토스트는 화면 위 가운데로 내려오며 나타난다(TDS 실측, 움직임 줄이기 설정이면 끔)">
      <Specimen label="Modal">
        <div className="row">
          <Button variant="secondary" onClick={() => setOpen("dialog")}>Dialog sm 320</Button>
          <Button variant="secondary" onClick={() => setOpen("modal")}>Modal md</Button>
          <Button variant="secondary" onClick={() => setOpen("modal-lg")}>Modal lg</Button>
        </div>
      </Specimen>
      <Specimen label="Drawer">
        <div className="row">
          <Button variant="secondary" onClick={() => setOpen("drawer")}>오른쪽</Button>
          <Button variant="secondary" onClick={() => setOpen("sheet")}>아래(바텀시트)</Button>
        </div>
      </Specimen>
      <Specimen label="Toast">
        <div className="row row-wrap">
          <Button variant="secondary" onClick={() => toast("알림 문구")}>neutral</Button>
          <Button variant="secondary" onClick={() => toast("저장했어요.", "success")}>success</Button>
          <Button variant="secondary" onClick={() => toast("문제가 생겼어요.", "danger")}>danger</Button>
        </div>
      </Specimen>
      <Modal open={open === "modal" || open === "modal-lg"} size={open === "modal-lg" ? "lg" : "md"} title="모달 제목" description="설명 문장" onClose={close}
        footer={<><Button variant="ghost" onClick={close}>취소</Button><Button onClick={close}>확인</Button></>}>
        모달 본문
      </Modal>
      <Modal open={open === "dialog"} size="sm" title="가이드를 공개할까요?" description="공개하면 링크가 있는 사람 누구나 볼 수 있어요." onClose={close}
        footer={<><Button variant="secondary" onClick={close}>닫기</Button><Button onClick={close}>공개하기</Button></>}>
        {null}
      </Modal>
      {(open === "drawer" || open === "sheet") && (
        <Drawer title="드로어 제목" description="설명 문장" side={open === "sheet" ? "bottom" : "right"} onClose={close}>드로어 본문</Drawer>
      )}
    </Group>
  );
}
