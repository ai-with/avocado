import { Badge, Button, Input, SectionCard, Textarea } from "../../../ui";
import { checklistFromRules, emptyVideoGuide, type GuideRule, type VideoGuide } from "../../../../shared/guides";
import { Warnings } from "../GuidelinesPage";
import { lines, type Busy, type SetField } from "../useGuideForm";

type Props = { vg: VideoGuide | null; setVg: (patch: Partial<VideoGuide>) => void; set: SetField; rules: GuideRule[]; vgWarnings: string[]; busy: Busy; onGenerate: () => void };

export function VideoGuideSection({ vg, setVg, set, rules, vgWarnings, busy, onGenerate }: Props) {
  const generateLabel = busy === "generate" ? "만드는 중 (최대 30초)" : vg ? "초안 다시 만들기" : "초안 만들기";
  const actions = (
    <>
      {!vg && <Button variant="ghost" onClick={() => set("videoGuide", { ...emptyVideoGuide(), draft: false })}>직접 쓰기</Button>}
      <Button variant="secondary" onClick={onGenerate} disabled={busy !== ""}>{generateLabel}</Button>
    </>
  );
  const title = <span className="row">영상 가이드{vg?.draft && <Badge tone="warn">초안</Badge>}</span>;
  return (
    <SectionCard title={title} actions={actions}>
      {!vg ? (
        <p className="text-secondary">제품과 규정을 넣고 '초안 만들기'를 누르면 장면 구성, 대사 예시(영어·한국어), 촬영 팁이 채워져요.</p>
      ) : (
        <VideoGuideFields vg={vg} setVg={setVg} rules={rules} vgWarnings={vgWarnings} />
      )}
    </SectionCard>
  );
}

function VideoGuideFields({ vg, setVg, rules, vgWarnings }: Pick<Props, "setVg" | "rules" | "vgWarnings"> & { vg: VideoGuide }) {
  return (
    <div className="stack">
      {vg.draft && <p className="text-caption">자동으로 만든 초안이에요. 고친 뒤 저장해야 인플루언서에게 공개할 수 있어요.</p>}
      <Warnings items={vgWarnings} />
      <Input label="영상 목적 한 줄" value={vg.purposeLine} onChange={(e) => setVg({ purposeLine: e.target.value })} />
      {vg.scenes.map((s, i) => <SceneFields key={s.key} vg={vg} index={i} setVg={setVg} />)}
      <Textarea label="촬영 팁 (한 줄에 하나)" value={vg.tips.join("\n")} onChange={(e) => setVg({ tips: e.target.value.split("\n") })} onBlur={(e) => setVg({ tips: lines(e.target.value) })} />
      <div className="stack-tight">
        <span className="field-label">체크리스트 (규정에서 자동으로 만들어요)</span>
        <ul className="plain-list">{checklistFromRules(rules).map((c) => <li key={c}>{c}</li>)}</ul>
      </div>
      <Textarea label="레퍼런스 영상 링크 (한 줄에 하나, 선택)" value={vg.references.join("\n")} onChange={(e) => setVg({ references: e.target.value.split("\n") })} onBlur={(e) => setVg({ references: lines(e.target.value) })} />
      <Input label="산출물 안내" value={vg.deliverables} onChange={(e) => setVg({ deliverables: e.target.value })} />
    </div>
  );
}

type Scene = VideoGuide["scenes"][number];

function SceneFields({ vg, index, setVg }: { vg: VideoGuide; index: number; setVg: (patch: Partial<VideoGuide>) => void }) {
  const s = vg.scenes[index]!;
  const update = (patch: Partial<Scene>) => setVg({ scenes: vg.scenes.map((x, j) => (j === index ? { ...x, ...patch } : x)) });
  return (
    <div className="scene-edit stack">
      <span className="field-label">{s.title}</span>
      <Textarea aria-label={`${s.title} 장면 설명`} value={s.description} onChange={(e) => update({ description: e.target.value })} placeholder="장면 설명" />
      <div className="grid-2">
        <Input label="대사 예시 (영어)" value={s.lineEn} onChange={(e) => update({ lineEn: e.target.value })} />
        <Input label="대사 예시 (한국어)" value={s.lineKo} onChange={(e) => update({ lineKo: e.target.value })} />
      </div>
    </div>
  );
}
