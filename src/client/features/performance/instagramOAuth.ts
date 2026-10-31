import { api } from "../../lib/api";
import type { IgTarget } from "../../../shared/performance";
import type { GuideLang } from "../../../shared/guide-public";

export async function beginInstagramOAuth(input: { target: IgTarget; token?: string; returnMode: "guide" | "connect" | "settings"; lang: GuideLang }, publicFlow = false): Promise<void> {
  const response = await api.post<{ authorizationUrl: string }>("/ig/oauth/start", input, publicFlow ? { redirectOn401: false } : {});
  const url = new URL(response.authorizationUrl, location.origin);
  const meta = url.protocol === "https:" && ["www.instagram.com", "instagram.com"].includes(url.hostname) && !url.username && !url.password && (!url.port || url.port === "443");
  const localCallback = url.origin === location.origin && url.pathname === "/api/ig/oauth/callback" && !url.username && !url.password;
  if (!meta && !localCallback) throw new Error("인스타그램 연결 주소를 확인하지 못했어요.");
  location.assign(url.href);
}
