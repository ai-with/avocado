import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Channel, DocumentRow, LinkRow } from "./common";

// /links 화면 데이터: 전체 링크, 채널, 자료. 아직 받기 전이면 loaded=false
export function useLinksPage() {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [l, d] = await Promise.all([api.get<{ links: LinkRow[]; channels: Channel[] }>("/links"), api.get<{ documents: DocumentRow[] }>("/documents")]);
    setLinks(l.links);
    setChannels(l.channels);
    setDocs(d.documents);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const removeDoc = async (d: DocumentRow) => {
    if (!confirm(`'${d.title}' 자료를 삭제할까요? 이 자료로 가는 링크는 '자료를 찾을 수 없어요'를 보여 줘요.`)) return;
    await api.del(`/documents/${d.id}`);
    await load();
  };
  return { links, channels, docs, loaded, load, removeDoc };
}
