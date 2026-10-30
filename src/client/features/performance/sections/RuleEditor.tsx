import { Button, Checkbox, Input, Modal, Textarea, SelectMenu } from "../../../ui";
import { fmtDateTime, type GuideInfluencerRow } from "../../guides/types";
import { renderDm } from "../../../../shared/performance";
import type { Media, Rule } from "../kdmTypes";
import { useRuleEditor, type RuleForm } from "../useRuleEditor";

const PREVIEW_LINK = "https://링크.예시/abc1234";
const CAPTION_PREVIEW_LENGTH = 30;

type FormProps = { f: RuleForm; setF: (f: RuleForm) => void; fields: Record<string, string> };

function MediaPicker({ f, setF, fields, media }: FormProps & { media: Media[] | null }) {
  return (
    <div className="stack-tight">
      <strong>브랜드 계정 게시물</strong>
      {media && media.length > 0 ? (
        <div className="kdm-media">
          {media.map((m) => (
            <button type="button" key={m.id} aria-pressed={f.igMediaId === m.id} onClick={() => setF({ ...f, igMediaId: m.id, mediaThumbUrl: m.thumbnail_url ?? m.media_url ?? null, mediaPermalink: m.permalink })}>
              {(m.thumbnail_url ?? m.media_url) && <img className="kdm-thumb" src={m.thumbnail_url ?? m.media_url} alt="" />}
              <div>{(m.caption ?? "").slice(0, CAPTION_PREVIEW_LENGTH) || "캡션 없음"}</div>
              <div className="text-caption">{fmtDateTime(Date.parse(m.timestamp))}</div>
            </button>
          ))}
        </div>
      ) : (
        <Input label="게시물 미디어 ID" hint="브랜드 계정이 아직 연결되지 않아 게시물 목록을 못 불러왔어요. 미디어 ID를 직접 넣어 주세요." value={f.igMediaId} error={fields.igMediaId} onChange={(e) => setF({ ...f, igMediaId: e.target.value })} />
      )}
    </div>
  );
}

function TargetFields({ f, setF, fields, guides, infs }: FormProps & { guides: { id: string; name: string }[]; infs: GuideInfluencerRow[] }) {
  return (
    <>
      <SelectMenu label="가이드" placeholder="고르기" options={guides.map((g) => ({ value: g.id, label: g.name }))} value={f.guideId || null} error={fields.guideId} onChange={(v) => setF({ ...f, guideId: v ?? "", influencerId: "" })} />
      <SelectMenu
        label="인플루언서 (이 게시물에 연결할 사람)"
        placeholder="고르기"
        options={infs.map((r) => ({ value: r.influencer.id, label: r.influencer.displayName }))}
        value={f.influencerId || null}
        error={fields.influencerId}
        onChange={(v) => setF({ ...f, influencerId: v ?? "" })}
      />
    </>
  );
}

function PublicReplies({ f, setF, defaults }: Omit<FormProps, "fields"> & { defaults: string[] }) {
  const toggle = (d: string, on: boolean) => setF({ ...f, publicReplyVariants: on ? [...f.publicReplyVariants, d] : f.publicReplyVariants.filter((x) => x !== d) });
  return (
    <fieldset className="fieldset-plain stack-tight">
      <legend><strong>공개 답글 (선택)</strong></legend>
      <p className="text-caption">고른 문구 중 하나를 무작위로 댓글에 달아요. 같은 문구 반복은 스팸으로 보일 수 있어요.</p>
      {defaults.map((d) => <Checkbox key={d} label={d} checked={f.publicReplyVariants.includes(d)} onChange={(e) => toggle(d, e.target.checked)} />)}
    </fieldset>
  );
}

type Props = { rule: Rule | null; defaults: string[]; brand: string; onClose: () => void; onSaved: () => Promise<void> };

export function RuleEditor({ rule, defaults, brand, onClose, onSaved }: Props) {
  const { f, setF, fields, submit, guides, infs, media } = useRuleEditor(rule, onSaved);
  const form = { f, setF, fields };
  return (
    <Modal open title={rule ? "규칙 편집" : "규칙 만들기"} onClose={onClose} size="lg">
      <form className="stack" onSubmit={submit}>
        <TargetFields {...form} guides={guides} infs={infs} />
        <MediaPicker {...form} media={media} />
        <Input label="키워드 (쉼표로 구분)" hint="대소문자와 띄어쓰기는 무시해요." value={f.keywords} error={fields.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} placeholder="자료, 신청" />
        <Textarea autoGrow label="DM 문구" hint="{link} 자리에 이 인플루언서의 '댓글 키워드 DM' 링크가 들어가요." value={f.message} error={fields.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
        <PublicReplies f={f} setF={setF} defaults={defaults} />
        <div className="stack-tight">
          <strong>미리보기</strong>
          <div className="kdm-preview">{renderDm(f.message, rule?.linkUrl ?? PREVIEW_LINK, brand)}</div>
        </div>
        <p className="text-caption">규칙은 꺼진 상태로 저장돼요. 목록에서 '켜기'를 눌러야 DM이 나가요. 문구를 바꾸면 다시 꺼져요.</p>
        <div className="row row-end">
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button type="submit">규칙 저장</Button>
        </div>
      </form>
    </Modal>
  );
}
