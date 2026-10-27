import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { NotificationItem, NotificationList } from "../../shared/notifications";

const POLL_MS = 60_000;
const EMPTY: NotificationList = { items: [], unread: 0 };

// 앱 안 알림. 60초마다 갱신하되 탭이 숨겨지면 멈추고, 다시 보이거나 창에 포커스가 오면 바로 갱신한다
export function useNotifications() {
  const [list, setList] = useState<NotificationList>(EMPTY);
  const load = useCallback(async () => {
    try {
      setList(await api.get<NotificationList>("/notifications"));
    } catch (e) {
      // 주기 갱신이라 실패해도 화면은 그대로 두고 다음 차례에 다시 받는다
      console.error("[notifications:load]", e);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    const onFocus = () => void load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // 화면은 먼저 읽음으로 바꾸고 서버에 알린다. 실패하면 다시 받아 맞춘다
  const markRead = async (item: NotificationItem) => {
    if (item.read) return;
    setList((l) => ({ items: l.items.map((i) => (i.id === item.id ? { ...i, read: true } : i)), unread: Math.max(0, l.unread - 1) }));
    await api.post(`/notifications/${item.id}/read`).catch(load);
  };
  const markAllRead = async () => {
    setList((l) => ({ items: l.items.map((i) => ({ ...i, read: true })), unread: 0 }));
    await api.post("/notifications/read-all").catch(load);
  };
  return { ...list, markRead, markAllRead };
}
