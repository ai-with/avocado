import { Link } from "react-router-dom";
import { Badge, Checkbox, Disclosure, SectionCard, Table } from "../../../ui";
import { RULE_SOURCE_LABELS, TERM_KIND_LABELS, type DictRule } from "../../../../shared/brand-terms";
import { SEVERITY_LABELS } from "../../../../shared/guides";
import type { GuideDictionary } from "../types";

type Props = { dictionary: GuideDictionary; excluded: string[]; onChange: (excluded: string[]) => void };

function DictTable({ rules, excluded, toggle }: { rules: DictRule[]; excluded: Set<string>; toggle: (id: string, on: boolean) => void }) {
  return (
    <Table columns={[{ label: "종류" }, { label: "내용" }, { label: "중요도" }, { label: "이번 캠페인" }]}>
      <tbody>
        {rules.map((r) => (
          <tr key={r.id}>
            <td className="nowrap">{TERM_KIND_LABELS[r.origin.kind]}</td>
            <td>{r.content}</td>
            <td className="nowrap"><Badge tone={r.severity === "must" ? "warn" : "neutral"}>{SEVERITY_LABELS[r.severity]}</Badge></td>
            <td className="nowrap"><Checkbox label={<><span className="sr-only">{r.content} </span>적용</>} checked={!excluded.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} /></td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// 캠페인 편집 > 브랜드 검수 사전에서 들어오는 규칙. 끄기는 이번 캠페인에만 적용되고 저장할 때 반영된다 (TASK-079)
export function BrandDictSection({ dictionary, excluded, onChange }: Props) {
  if (!dictionary.brandId) return null;
  const off = new Set(excluded);
  const toggle = (id: string, on: boolean) => onChange(on ? excluded.filter((x) => x !== id) : [...excluded, id]);
  const brand = dictionary.rules.filter((r) => r.origin.source === "brand");
  const legal = dictionary.rules.filter((r) => r.origin.source === "legal");
  const active = dictionary.rules.filter((r) => !off.has(r.id)).length;
  const legalActive = legal.filter((r) => !off.has(r.id)).length;
  return (
    <SectionCard
      title="브랜드 검수 사전"
      description={`브랜드 사전에서 들어오는 규칙 ${active}개가 이 캠페인 검수에 쓰여요. 이번 캠페인에서만 빼려면 적용을 끄세요.`}
      actions={<Link to={`/dashboard/settings/brands/${dictionary.brandId}/terms`}>사전 편집</Link>}
    >
      <div className="stack">
        <h5 className="guide-subhead">{RULE_SOURCE_LABELS.brand} {brand.length}개</h5>
        {brand.length ? <DictTable rules={brand} excluded={off} toggle={toggle} /> : <p className="text-caption">아직 사전 항목이 없어요. 사전 편집에서 추가하면 여기에 들어와요.</p>}
        {legal.length > 0 && (
          <Disclosure title={`${RULE_SOURCE_LABELS.legal}: 화장품 광고 금지 표현`} description={`${legalActive}/${legal.length}개 적용`}>
            <DictTable rules={legal} excluded={off} toggle={toggle} />
          </Disclosure>
        )}
      </div>
    </SectionCard>
  );
}
