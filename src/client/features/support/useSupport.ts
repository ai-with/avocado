import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import { useToast } from "../../ui";
import { useSubmit } from "../../pages/useSubmit";
import { isSupportType, type SupportRequestItem, type SupportType } from "../../../shared/support";
import { fetchSupportRequests, sendSupportRequest } from "./api";

export type SupportDraft = { type: SupportType; body: string; replyEmail: string };

// 내가 보낸 문의 목록. 받기 전에는 null
function useSupportList() {
  const toast = useToast();
  const [requests, setRequests] = useState<SupportRequestItem[] | null>(null);
  const load = () =>
    fetchSupportRequests()
      .then(setRequests)
      .catch((e: unknown) => {
        setRequests([]);
        toast(errorMessage(e), "danger");
      });
  useEffect(() => {
    void load();
    // 처음 한 번만 받는다. 이후에는 제출 뒤 load 로 새로 받는다
  }, []);
  return { requests, load };
}

// 문의 양식 상태와 제출. ?type=plan 이면 요금제 변경을 골라 둔다
export function useSupport() {
  const [params] = useSearchParams();
  const { me } = useMe();
  const toast = useToast();
  const queryType = params.get("type");
  const initial = (): SupportDraft => ({ type: isSupportType(queryType) ? queryType : "usage", body: "", replyEmail: me?.user.email ?? "" });
  const [draft, setDraft] = useState<SupportDraft>(initial);
  const list = useSupportList();
  const submit = useSubmit();

  // me 가 늦게 오면 비어 있는 회신 이메일만 채운다
  useEffect(() => {
    if (me?.user.email) setDraft((d) => (d.replyEmail ? d : { ...d, replyEmail: me.user.email }));
  }, [me?.user.email]);

  const set = <K extends keyof SupportDraft>(key: K, value: SupportDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const send = () =>
    submit.run(async () => {
      await sendSupportRequest(draft);
      toast("문의를 받았어요. 회신 이메일로 답해 드릴게요.", "success");
      setDraft(initial());
      submit.reset();
      await list.load();
    });
  return { draft, set, send, requests: list.requests, ...submit };
}
