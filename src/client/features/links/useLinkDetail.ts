import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { uploadImage, type LinkRow } from "./common";

const QR_SIZE_PX = 512;
const QR_MARGIN = 2;

// QR 이미지 만들기와 내려받기(내려받은 횟수는 서버에 기록)
function useQr(link: LinkRow) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    void QRCode.toDataURL(link.url, { width: QR_SIZE_PX, margin: QR_MARGIN }).then(setQr);
  }, [link.url]);
  const downloadQr = () => {
    const a = document.createElement("a");
    a.href = qr;
    a.download = `qr-${link.slug}.png`;
    a.click();
    void api.post(`/links/${link.id}/qr`);
  };
  return { qr, downloadQr };
}

// 링크 상세 모달의 상태와 저장·QR·삭제 동작
export function useLinkDetail(link: LinkRow, onClose: () => void, onChanged: () => void) {
  const toast = useToast();
  const [og, setOg] = useState(link.og);
  const [utm, setUtm] = useState(link.utm);

  const { qr, downloadQr } = useQr(link);
  const save = async (body: object, done: string) => {
    try {
      await api.patch(`/links/${link.id}`, body);
      toast(done, "success");
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { key } = await uploadImage(file);
      setOg((p) => ({ ...p, imageKey: key }));
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  const remove = async () => {
    if (!confirm("링크를 삭제할까요? 이미 보낸 링크를 누르면 만료 안내가 보여요.")) return;
    await api.del(`/links/${link.id}`);
    toast("링크를 삭제했어요.");
    onChanged();
    onClose();
  };
  return { qr, og, setOg, utm, setUtm, save, downloadQr, pickImage, remove };
}

export type LinkDetailState = ReturnType<typeof useLinkDetail>;
