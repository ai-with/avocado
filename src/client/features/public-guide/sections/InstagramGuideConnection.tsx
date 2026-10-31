import { useLocation } from "react-router-dom";
import { ButtonLink } from "../../../ui";
import { withLangParam, type GuideLang } from "../../../../shared/guide-public";
import type { PublicInstagramLink } from "../../../../shared/instagram-connection";
import type { T } from "../guideTypes";
import { PublicSection } from "./PublicShell";

export function InstagramGuideConnection({ info, lang, t }: { info: PublicInstagramLink; lang: GuideLang; t: T }) {
  const params = new URLSearchParams(useLocation().search);
  const outcome = params.get("ig");
  const disconnected = ["expired", "token_missing", "provider_auth_invalid", "manual"].includes(info.status);
  const connected = info.connected && info.status === "connected";
  const safePath = /^\/connect\/[A-Za-z0-9_-]+(?:\?|$)/.test(info.connectUrl) ? withLangParam(info.connectUrl, lang) : null;
  return <PublicSection title={t("ig_connection_title")}>
    {outcome === "connected" && connected && <p className="pub-ok" role="status">{t("ig_connected_done")}</p>}
    {outcome === "cancelled" && <p className="text-secondary" role="status">{t("ig_cancelled")}</p>}
    {outcome === "failed" && <p className="pub-error" role="alert">{t("ig_failed")}</p>}
    <p>{connected ? `${t("ig_connected")}${info.username ? ` @${info.username}` : ""}` : disconnected ? t("ig_disconnected") : info.status === "not_connected" ? t("ig_connection_hint") : t("ig_verify_needed")}</p>
    <p className="text-caption">{t("ig_optional")}</p>
    {!info.configured && !connected && <p className="text-secondary">{t("ig_preparing")}</p>}
    {safePath && <ButtonLink to={safePath}>{connected ? t("ig_manage") : disconnected ? t("ig_reconnect") : t("ig_connect")}</ButtonLink>}
  </PublicSection>;
}
