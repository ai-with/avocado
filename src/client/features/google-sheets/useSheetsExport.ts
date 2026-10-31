import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, ApiError, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import type { SheetsConnection, SheetsJob, SheetsKind } from "./types";

async function requestIdFor(scope: string, filters: string, forceNew: boolean): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(filters)));
  const key = `sheets-export:${scope}:${Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  try {
    const saved = sessionStorage.getItem(key);
    if (!forceNew && saved && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) return saved;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch { return crypto.randomUUID(); }
}

export function useSheetsExport(kind: SheetsKind, query: string) {
  const { me } = useMe();
  const location = useLocation();
  const callback = new URLSearchParams(location.search).get("sheets");
  const [open, setOpen] = useState(callback === "connected" || callback === "failed" || callback === "cancelled");
  const [connection, setConnection] = useState<SheetsConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<SheetsJob | null>(null);
  const [error, setError] = useState(callback === "failed" ? "Google 계정 연결을 마치지 못했어요. 다시 연결해 주세요." : callback === "cancelled" ? "Google 계정 연결을 취소했어요." : "");
  const running = useRef(false);
  const statusRequest = useRef(0);
  const request = useRef<{ key: string; id: string } | null>(null);
  const filters = useMemo(() => { const params = new URLSearchParams(query); params.sort(); return Object.fromEntries(params); }, [query]);
  const accountScope = `${me?.user.id ?? "current"}:${me?.workspace?.id ?? "current"}:${kind}`;
  const requestScope = `${accountScope}:${connection?.generation ?? "unconnected"}`;
  const filterKey = `${requestScope}:${JSON.stringify(filters)}`;
  const currentKey = useRef(filterKey);
  currentKey.current = filterKey;

  const refresh = useCallback(async () => {
    const ticket = ++statusRequest.current;
    setLoading(true);
    try { const status = await api.get<SheetsConnection>("/google-sheets/status"); if (ticket === statusRequest.current) setConnection(status); return status; }
    catch (cause) { if (ticket === statusRequest.current) { setConnection(null); setError(errorMessage(cause)); } return null; }
    finally { if (ticket === statusRequest.current) setLoading(false); }
  }, [accountScope]);
  useEffect(() => { setConnection(null); void refresh(); return () => { statusRequest.current++; }; }, [refresh]);
  useEffect(() => { request.current = null; setJob(null); }, [filterKey]);

  const action = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    try { await work(); } catch (cause) {
      if (currentKey.current === filterKey) { setError(errorMessage(cause)); if (cause instanceof ApiError && cause.code === "connection_changed") await refresh(); }
    }
    finally { running.current = false; setBusy(false); }
  };
  const csrf = () => {
    if (!connection?.csrfToken) throw new Error("연결 상태를 다시 확인해 주세요.");
    return { headers: { "X-CSRF-Token": connection.csrfToken } };
  };
  const connect = () => action(async () => {
    const route = kind === "leads" ? "/dashboard/leads" : "/dashboard/performance";
    const returnTo = `${route}${query ? `?${query}` : ""}`;
    const { authorizationUrl } = await api.post<{ authorizationUrl: string }>("/google-sheets/connect", { returnTo }, csrf());
    const url = new URL(authorizationUrl);
    if (url.protocol !== "https:" || url.hostname !== "accounts.google.com" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Google 연결 주소를 확인하지 못했어요.");
    if (currentKey.current === filterKey) window.location.assign(url.href);
  });
  const disconnect = () => action(async () => {
    await api.post("/google-sheets/disconnect", {}, csrf());
    if (currentKey.current === filterKey) { setConnection((previous) => previous && { ...previous, connected: false, accountEmail: null }); setJob(null); }
  });
  const exportRows = (forceNew = false) => action(async () => {
    if (!connection?.configured || !connection.connected || !connection.generation) throw new Error("Google 계정을 먼저 연결해 주세요.");
    if (forceNew || request.current?.key !== filterKey) {
      request.current = { key: filterKey, id: await requestIdFor(requestScope, filterKey, forceNew) };
    }
    const result = await api.post<SheetsJob>("/google-sheets/exports", { requestId: request.current!.id, kind, filters, connectionGeneration: connection.generation }, csrf());
    if (currentKey.current === filterKey) { setJob(result); if (result.errorCode === "reconnect_required") await refresh(); }
  });
  const check = () => action(async () => { if (job) { const result = await api.get<SheetsJob>(`/google-sheets/exports/${encodeURIComponent(job.id)}`); if (currentKey.current === filterKey) setJob(result); } });
  return { open, setOpen, connection, loading, busy, job, error, refresh, connect, disconnect, exportRows, check };
}
