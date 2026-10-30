import { useState } from "react";
import { LoadingState, PageHeader, Tabs } from "../../ui";
import { useMe } from "../../lib/me";
import { useMessageTemplates, useMessageVariables } from "../../features/messages/api";
import { TemplatesTab } from "../../features/messages/sections/TemplatesTab";
import { VariablesTab } from "../../features/messages/sections/VariablesTab";

type Tab = "templates" | "variables";
const TABS: { value: Tab; label: string }[] = [
  { value: "templates", label: "템플릿" },
  { value: "variables", label: "변수" },
];

// /dashboard/settings/messages: 인플루언서에게 보낼 메시지 템플릿과 변수 (TASK-073)
export function MessagesSettingsPage() {
  const { me } = useMe();
  const canEdit = me?.role === "owner" || me?.role === "editor";
  const [tab, setTab] = useState<Tab>("templates");
  const { templates, reload: reloadTemplates } = useMessageTemplates();
  const { variables, reload: reloadVariables } = useMessageVariables();
  return (
    <>
      <PageHeader title="메시지 템플릿" description="자주 보내는 DM을 언어별 템플릿으로 만들어요. 캠페인 인플루언서 목록에서 값을 채워 복사하거나 이메일로 보낼 수 있어요." />
      <div className="stack">
        <Tabs<Tab> label="메시지 템플릿 보기" tabs={TABS} value={tab} onChange={setTab} />
        {variables === null ? (
          <LoadingState />
        ) : tab === "templates" ? (
          <TemplatesTab templates={templates} variables={variables} canEdit={canEdit} reload={reloadTemplates} />
        ) : (
          <VariablesTab variables={variables} canEdit={canEdit} reload={async () => void (await Promise.all([reloadVariables(), reloadTemplates()]))} />
        )}
      </div>
    </>
  );
}
