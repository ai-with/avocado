import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useMe } from "../../lib/me";

export type MessageAvailability = { workspaceId: string; senderConfigured: boolean; sendPolicy: { configured: boolean; message: string }; csrfToken: string };
export const getMessageAvailability = () => api.get<MessageAvailability>("/messaging/settings");
export function useMessageAvailability() {
  const workspace = useMe().me?.workspace?.id;
  const [value, setValue] = useState<MessageAvailability | null>(null);
  useEffect(() => { let active = true; setValue(null); void getMessageAvailability().then((r) => { if (active) setValue(r); }, () => {}); return () => { active = false; }; }, [workspace]);
  return { available: value?.senderConfigured === true && value?.sendPolicy?.configured === true, message: value?.sendPolicy?.message || "발송 기준을 준비하고 있어요. 실제 발송은 아직 사용할 수 없어요.", csrfToken: value?.csrfToken ?? "" };
}
export async function messageHeaders(workspaceId: string, generation?: string) {
  const value = await getMessageAvailability();
  if (value.workspaceId !== workspaceId) throw new Error("워크스페이스가 바뀌었어요. 화면을 다시 열어 주세요.");
  return { "X-CSRF-Token": value.csrfToken, "X-Message-Workspace": workspaceId, ...(generation !== undefined && { "X-Message-Generation": generation }) };
}
