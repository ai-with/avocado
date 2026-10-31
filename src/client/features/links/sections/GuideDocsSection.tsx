import { useState } from "react";
import { Button } from "../../../ui";
import { DocumentCard } from "../DocumentCard";
import { DocumentSettingsModal } from "../DocumentPanel";
import { docSize, documentStatsText, gateLabel, type Channel, type DocumentRow } from "../common";

type Props = { docs: DocumentRow[]; channels: Channel[]; onSaved: () => void };

// 가이드에 딸린 자료(가이드에서 올렸거나 이 가이드 링크의 목적지인 자료)
export function GuideDocsSection({ docs, channels, onSaved }: Props) {
  const [settingsFor, setSettingsFor] = useState<DocumentRow | null>(null);
  const [statsFor, setStatsFor] = useState<string | null>(null);
  if (docs.length === 0) return null;
  return (
    <section className="stack">
      <h4>이 가이드의 자료</h4>
      {docs.map((d) => (
        <DocumentCard
          key={d.id}
          doc={d}
          channels={channels}
          heading={<b>{d.title}</b>}
          meta={`${docSize(d)} · 게이트 ${gateLabel(d.gate)} · ${documentStatsText(d.stats)}`}
          actions={<Button size="sm" variant="secondary" onClick={() => setSettingsFor(d)}>게이트·설정</Button>}
          statsOpen={statsFor === d.id}
          onToggleStats={() => setStatsFor(statsFor === d.id ? null : d.id)}
        />
      ))}
      {settingsFor && <DocumentSettingsModal doc={settingsFor} onClose={() => setSettingsFor(null)} onSaved={onSaved} />}
    </section>
  );
}
