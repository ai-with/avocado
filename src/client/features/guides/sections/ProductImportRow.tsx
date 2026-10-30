import type { KeyboardEvent } from "react";
import { Button, Input, Modal } from "../../../ui";
import { useProductImport } from "../useProductImport";
import type { GuideForm, SetField } from "../useGuideForm";

type Props = { form: GuideForm; set: SetField };

// 기본 정보 맨 위 '상품 URL로 채우기' 줄과 덮어쓰기 확인
export function ProductImportRow({ form, set }: Props) {
  const p = useProductImport(form, set);
  // 가이드 폼 안이라 Enter 가 저장(submit)으로 가지 않게 막고 가져오기로 돌린다
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!p.busy) void p.run();
  };
  return (
    <div className="stack">
      <p className="guide-subhead">상품 URL로 채우기</p>
      <div className="row row-start url-row">
        <Input
          aria-label="상품 페이지 주소"
          type="url"
          inputMode="url"
          placeholder="https://"
          value={p.url}
          onChange={(e) => p.setUrl(e.target.value)}
          onKeyDown={onKeyDown}
          error={p.error}
          hint="공개된 상품 상세 페이지 주소를 넣으면 제품 이름, 효능, 사용법, 사진을 채워요."
          maxLength={2000}
        />
        <Button variant="secondary" onClick={() => void p.run()} loading={p.busy}>가져오기</Button>
      </div>
      {p.pending && (
        <Modal
          open
          title="입력한 내용을 바꿀까요?"
          description="가져온 값이 있는 칸(제품 이름, 효능, 사용법, 사진)은 새 값으로 바뀌어요. 영상 목적은 비어 있을 때만 채워요."
          onClose={p.cancel}
          footer={
            <>
              <Button variant="ghost" onClick={p.cancel}>그대로 두기</Button>
              <Button onClick={() => p.pending && p.apply(p.pending)} data-autofocus>바꾸기</Button>
            </>
          }
        >
          <p className="text-secondary">가져온 제품: {p.pending.product.name || "이름 없음"}</p>
        </Modal>
      )}
    </div>
  );
}
