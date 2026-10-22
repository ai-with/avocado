import { useState } from "react";
import { Button, SectionCard, useToast } from "../../ui";
import { useMe } from "../../lib/me";
import { PhoneVerifyForm } from "../VerifyPhone";
import "./settings.css";

// 설정 > 워크스페이스 · 팀 의 내 계정. 번호 변경은 새 번호로 다시 인증해야 바뀐다
export function MyAccountSection() {
  const { me, refresh } = useMe();
  const toast = useToast();
  const [changing, setChanging] = useState(false);
  if (!me) return null;
  const onPhoneChanged = async () => {
    await refresh();
    setChanging(false);
    toast("휴대폰 번호를 바꿨습니다.", "success");
  };
  return (
    <SectionCard title="내 계정" description={`${me.user.name} · ${me.user.email}`}>
      <div className="row row-wrap">
        <span className="text-secondary">휴대폰 {me.user.phone ?? "미등록"}</span>
        {!changing && <Button variant="secondary" size="sm" onClick={() => setChanging(true)}>번호 변경</Button>}
      </div>
      {changing && (
        <div className="settings-phone-form">
          <PhoneVerifyForm submitLabel="번호 변경" onDone={onPhoneChanged} />
        </div>
      )}
    </SectionCard>
  );
}
