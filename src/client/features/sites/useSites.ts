import { useCallback, useEffect, useState } from "react";
import { useToast } from "../../ui";
import { errorMessage } from "../../lib/api";
import { sitesApi, type Site } from "./api";

// 첫 이벤트를 기다리는 사이트가 있으면 이 간격으로 다시 불러와 '수신됨'을 바로 보여 준다
const WAITING_POLL_MS = 10_000;

// 사이트 분석 화면 데이터: 목록, 변경 후 다시 불러오기
export function useSites() {
  const toast = useToast();
  const [sites, setSites] = useState<Site[] | null>(null);

  const load = useCallback(async () => setSites(await sitesApi.list()), []);
  useEffect(() => {
    void load();
  }, [load]);

  const waiting = sites?.some((s) => !s.firstEventAt) ?? false;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), WAITING_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, load]);

  // 변경 요청 뒤 성공 알림과 다시 불러오기를 한 번에 처리한다
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast(done, "success");
      await load();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };

  const rotateKey = (s: Site) =>
    confirm(`'${s.name}'의 사이트 키를 새로 만들까요? 이미 설치한 스크립트는 새 스니펫으로 바꿔야 다시 수집돼요.`) &&
    void act(() => sitesApi.rotateKey(s.id), "사이트 키를 새로 만들었어요. 설치 스니펫을 다시 복사해 주세요.");
  const remove = (s: Site) => confirm(`'${s.name}' 사이트를 지울까요? 이후 수집은 멈추고 쌓인 집계는 남아요.`) && void act(() => sitesApi.remove(s.id), "사이트를 지웠어요.");

  return { sites, load, rotateKey, remove };
}
