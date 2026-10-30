import { useState, type FormEvent } from "react";
import { Button, ButtonLink, EmptyState, Input, LoadingState, Modal, PageHeader, Table, useToast } from "../../ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import { useBrands, type Brand } from "../../features/campaigns/api";
import { brandDeleteBlock } from "../../../shared/campaigns";

type Editing = { id: string | null; name: string };

function useBrandEditor(reload: () => Promise<void>, liveCount: number) {
  const toast = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [blocked, setBlocked] = useState<{ brand: Brand; message: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      if (editing.id) await api.patch(`/brands/${editing.id}`, { name: editing.name });
      else await api.post("/brands", { name: editing.name });
      setEditing(null);
      setFields({});
      await reload();
    } catch (err) {
      if (err instanceof ApiError) setFields(err.fields);
      toast(errorMessage(err), "danger");
    }
  };
  // 캠페인이 있거나 마지막 브랜드면 지우지 않고 이유만 알린다 (서버도 같은 규칙으로 막는다)
  const remove = async (b: Brand) => {
    const block = brandDeleteBlock(b.campaignCount, liveCount);
    if (block) return setBlocked({ brand: b, message: block });
    if (!confirm(`${b.name} 브랜드를 지울까요?`)) return;
    try {
      await api.del(`/brands/${b.id}`);
      await reload();
    } catch (err) {
      toast(errorMessage(err), "danger");
    }
  };
  return { editing, setEditing, fields, save, remove, blocked, closeBlocked: () => setBlocked(null) };
}

function BrandRow({ b, canEdit, onEdit, onRemove }: { b: Brand; canEdit: boolean; onEdit: () => void; onRemove: () => void }) {
  return (
    <tr>
      <td>{b.name}</td>
      <td className="num">{b.campaignCount}</td>
      <td className="text-right">
        <div className="row row-end">
          <ButtonLink size="sm" variant="ghost" to={`/dashboard/settings/brands/${b.id}/terms`}>검수 사전</ButtonLink>
          {canEdit && <>
            <Button size="sm" variant="ghost" onClick={onEdit}>이름 수정</Button>
            <Button size="sm" variant="ghost" onClick={onRemove}>삭제</Button>
          </>}
        </div>
      </td>
    </tr>
  );
}

// /dashboard/settings/brands: 워크스페이스 안의 브랜드 (TASK-070). 공개 화면·메일에는 캠페인 브랜드 이름이 보인다
export function BrandsSettingsPage() {
  const { me } = useMe();
  const canEdit = me?.role === "owner" || me?.role === "editor";
  const { brands, reload } = useBrands();
  const { editing, setEditing, fields, save, remove, blocked, closeBlocked } = useBrandEditor(reload, brands?.length ?? 0);
  const add = <Button onClick={() => setEditing({ id: null, name: "" })}>브랜드 추가</Button>;

  return (
    <>
      <PageHeader title="브랜드" description="브랜드마다 캠페인을 만들어요. 인플루언서가 보는 가이드와 메일에는 캠페인의 브랜드 이름이 나와요." actions={canEdit && add} />
      {brands === null ? <LoadingState pattern="table" /> : brands.length === 0 ? (
        <EmptyState title="브랜드가 없어요" description="브랜드를 추가하면 캠페인을 만들 수 있어요." action={canEdit && add} />
      ) : (
        <Table>
          <thead>
            <tr><th>이름</th><th className="num">캠페인</th><th><span className="sr-only">관리</span></th></tr>
          </thead>
          <tbody>
            {brands.map((b) => <BrandRow key={b.id} b={b} canEdit={canEdit} onEdit={() => setEditing({ id: b.id, name: b.name })} onRemove={() => void remove(b)} />)}
          </tbody>
        </Table>
      )}
      <Modal
        open={blocked !== null}
        title={`${blocked?.brand.name ?? ""} 브랜드는 지울 수 없어요`}
        description={blocked?.message}
        onClose={closeBlocked}
        footer={
          <>
            <Button variant="ghost" onClick={closeBlocked}>닫기</Button>
            {blocked && blocked.brand.campaignCount > 0 && <ButtonLink variant="primary" to={`/dashboard/campaigns?brand=${blocked.brand.id}`}>캠페인 보기</ButtonLink>}
          </>
        }
      >
        {null}
      </Modal>
      <Modal open={editing !== null} title={editing?.id ? "브랜드 이름 수정" : "브랜드 추가"} onClose={() => setEditing(null)}>
        {editing && (
          <form className="stack" onSubmit={save}>
            <Input label="브랜드 이름" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} error={fields.name} maxLength={60} required />
            <div className="row row-end">
              <Button variant="ghost" onClick={() => setEditing(null)}>취소</Button>
              <Button type="submit">저장</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
