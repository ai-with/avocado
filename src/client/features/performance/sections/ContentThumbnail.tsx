import { useEffect, useState } from "react";
import { Icon } from "../../../ui";

export function ContentThumbnail({ src, fetchedAt }: { src: string | null; fetchedAt: number | null }) {
  const [failed, setFailed] = useState(false);
  const safe = src?.startsWith("/api/performance/contents/") ? src : null;
  const url = safe ? `${safe}${safe.includes("?") ? "&" : "?"}v=${fetchedAt ?? 0}` : null;
  useEffect(() => setFailed(false), [url]);
  return <span className="perf-thumbnail" aria-hidden="true">
    {url && !failed ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <Icon name="file-text" />}
  </span>;
}
