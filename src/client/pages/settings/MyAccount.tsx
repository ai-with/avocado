import { useState } from "react";
import { Avatar, Button, ListRow, SectionCard, useToast } from "../../ui";
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
    toast("휴대폰 번호를 바꿨어요.", "success");
  };
  return (
    <SectionCard title="내 계정">
      <ListRow padding="sm" leading={<Avatar name={me.user.name || me.user.email} />} title={me.user.name} description={me.user.email} />
      <ListRow
        padding="sm"
        title="휴대폰"
        description={me.user.phone ?? "미등록"}
        trailing={!changing && <Button variant="secondary" size="sm" onClick={() => setChanging(true)}>번호 변경</Button>}
      />
      {changing && (
        <div className="settings-phone-form">
          <PhoneVerifyForm submitLabel="번호 변경" onDone={onPhoneChanged} />
        </div>
      )}
    </SectionCard>
  );
}
