import { useToast } from "../../ui";
import { errorMessage } from "../../lib/api";

// 요청 하나를 실행하고 성공 토스트 뒤 목록을 다시 불러온다. 실패하면 오류 토스트
export function useAction(load: () => Promise<void>) {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast(done, "success");
      await load();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
}
