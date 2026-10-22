import { useState, type FormEvent } from "react";
import { Button, Checkbox, Input, Modal, Select, Textarea, useToast } from "../../../ui";
import { ApiError, errorMessage } from "../../../lib/api";
import { sitesApi, type ConsentMode, type Site, type SiteInput } from "../api";

type Props = { site: Site | null; onClose: () => void; onSaved: () => void };

const toLines = (domains: string[]) => domains.join("\n");
const fromLines = (text: string) => text.split(/[\n,]/).map((d) => d.trim()).filter(Boolean);

function useSiteForm(site: Site | null, onSaved: () => void) {
  const toast = useToast();
  const [name, setName] = useState(site?.name ?? "");
  const [domains, setDomains] = useState(site ? toLines(site.domains) : "");
  const [consentMode, setConsentMode] = useState<ConsentMode>(site?.consentMode ?? "auto");
  const [collectRawEmail, setCollectRawEmail] = useState(site?.collectRawEmail ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input: SiteInput = { name, domains: fromLines(domains), consentMode, collectRawEmail };
    setSaving(true);
    try {
      await (site ? sitesApi.update(site.id, input) : sitesApi.create(input));
      toast(site ? "사이트 설정을 저장했어요." : "사이트를 등록했어요. 설치 스니펫을 사이트에 넣어 주세요.", "success");
      onSaved();
    } catch (err) {
      setErrors(err instanceof ApiError ? err.fields : {});
      toast(errorMessage(err), "danger");
    } finally {
      setSaving(false);
    }
  };
  const values = { name, domains, consentMode, collectRawEmail };
  const setters = { setName, setDomains, setConsentMode, setCollectRawEmail };
  return { values, setters, errors, saving, submit };
}

const DOMAIN_HINT = "한 줄에 하나씩. *.example.com 은 example.com 과 모든 하위 도메인을 포함해요. 여기 있는 도메인에서 온 수집만 받고, 리드 링크의 클릭 ID(avc)도 여기 있는 도메인에만 붙어요.";
const CONSENT_HINT = "동의 필요를 고르면 사이트의 동의 배너가 avocado('consent', 'granted')를 부르기 전에는 아무것도 수집하지 않아요.";
const RAW_EMAIL_LABEL = "identify 이메일 원문 받기 (켜면 사이트에서 식별한 사람이 리드로 올라가요. 끄면 해시로 기존 리드와만 이어요)";

// 사이트 등록·설정. site 가 null 이면 새로 만든다
export function SiteFormModal({ site, onClose, onSaved }: Props) {
  const { values: v, setters: s, errors, saving, submit } = useSiteForm(site, onSaved);
  const footer = (
    <>
      <Button variant="secondary" onClick={onClose}>취소</Button>
      <Button type="submit" form="site-form" disabled={saving}>{site ? "저장" : "등록"}</Button>
    </>
  );
  return (
    <Modal open title={site ? "사이트 설정" : "사이트 등록"} onClose={onClose} footer={footer}>
      <form id="site-form" className="stack-tight" onSubmit={(e) => void submit(e)}>
        <Input label="사이트 이름" value={v.name} onChange={(e) => s.setName(e.target.value)} error={errors.name} required data-autofocus />
        <Textarea label="허용 도메인" hint={DOMAIN_HINT} value={v.domains} onChange={(e) => s.setDomains(e.target.value)} error={errors.domains} rows={3} required />
        <Select label="동의 모드" hint={CONSENT_HINT} value={v.consentMode} onChange={(e) => s.setConsentMode(e.target.value as ConsentMode)}>
          <option value="auto">고지 기반 (국내 사이트 기본)</option>
          <option value="require">동의 필요 (해외 이용자 대상)</option>
        </Select>
        <Checkbox label={RAW_EMAIL_LABEL} checked={v.collectRawEmail} onChange={(e) => s.setCollectRawEmail(e.target.checked)} />
      </form>
    </Modal>
  );
}
