import { useState } from "react";
import { useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { checksOf, NEW, sentence, type Automation, type Draft, type Lookups } from "./automation-model";

const NAME_MAX = 80;

// 자동 발송 규칙 편집 상태와 저장·테스트·삭제
export function useAutomationEditor(initial: Automation | null, lk: Lookups, connected: boolean, onDone: () => void) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(initial ?? NEW);
  const [step, setStep] = useState(1);
  const set = (patch: Partial<Draft>) => setD((p) => ({ ...p, ...patch }));
  const fail = (e: unknown) => toast(errorMessage(e), "danger");

  const save = async () => {
    try {
      const body = { ...d, name: d.name || sentence(d, lk).slice(0, NAME_MAX) };
      if (initial) {
        const r = await api.patch<{ turnedOff: boolean }>(`/automations/${initial.id}`, body);
        toast(r.turnedOff ? "저장했어요. 점검을 통과하지 못해 규칙을 껐어요." : "저장했어요.", r.turnedOff ? "danger" : "success");
      } else {
        await api.post("/automations", body);
        toast("꺼진 상태로 저장했어요. 목록에서 켜면 동작해요.", "success");
      }
      onDone();
    } catch (e) {
      fail(e);
    }
  };
  const test = async () => {
    try {
      const r = await api.post<{ to: string; delivered: boolean }>(`/automations/${initial!.id}/test`);
      toast(r.delivered ? `${r.to} 주소로 테스트 메일을 보냈어요.` : "이메일 발송 설정이 없어 실제로 보내지는 않았어요. 기록만 남겼어요.", r.delivered ? "success" : "neutral");
    } catch (e) {
      fail(e);
    }
  };
  const remove = async () => {
    if (!initial || !confirm("이 규칙을 지울까요? 이미 보낸 기록은 남아요.")) return;
    await api.del(`/automations/${initial.id}`);
    onDone();
  };

  return { d, set, step, setStep, checks: checksOf(d, connected), blockedAlimtalk: d.channel === "alimtalk" && !connected, save, test, remove };
}
