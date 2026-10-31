import { useEffect, useRef, useState, type FormEvent } from "react";
import { Badge, Button, Checkbox, LoadingState, Modal, NumberField, Select } from "../../../ui";
import { api, ApiError, errorMessage } from "../../../lib/api";
import type { SiteAlertMetric, SiteAlertStatus } from "../../../../shared/site-alerts";

const date = (at: number) => new Date(at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
const metricLabel = (metric: SiteAlertMetric) => metric === "pageviews" ? "페이지뷰" : "전환 수";
const mailStatus: Record<string, string> = { queued: "발송 대기", blocked: "발송 준비 중", sending: "발송 처리 중", failed: "재시도 대기", sent: "발송 요청 완료", cancelled: "발송 취소", expired: "유효 기간 만료", unknown: "결과 미확인 · 자동 재전송 중단" };
type Form = { enabled: boolean; metric: SiteAlertMetric; ratioPercent: number | null; minimumAverage: number | null; confirmationDays: number; subscribed: boolean };

export function SiteAlertModal({ siteId, name, onClose }: { siteId: string; name: string; onClose: () => void }) {
  const [data, setData] = useState<SiteAlertStatus | null>(null), [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState(""), [saved, setSaved] = useState(false), [busy, setBusy] = useState(false);
  const mounted = useRef(false), running = useRef(false), actor = useRef(siteId);
  actor.current = siteId;
  const load = async () => {
    const value = await api.get<SiteAlertStatus>(`/site-alerts/${encodeURIComponent(siteId)}`);
    if (mounted.current && actor.current === siteId) { setData(value); setForm({ ...value.policy, subscribed: value.subscribed }); }
  };
  useEffect(() => { mounted.current = true; setData(null); setForm(null); setError(""); setSaved(false); void load().catch((cause: unknown) => { if (mounted.current && actor.current === siteId) setError(errorMessage(cause)); }); return () => { mounted.current = false; }; }, [siteId]);
  const change = <K extends keyof Form>(key: K, value: Form[K]) => { setSaved(false); setForm((previous) => previous && { ...previous, [key]: value }); };
  const metric = (value: SiteAlertMetric) => {
    setSaved(false); setForm((previous) => previous && { ...previous, metric: value, minimumAverage: previous.minimumAverage === (previous.metric === "pageviews" ? 100 : 10) ? value === "pageviews" ? 100 : 10 : previous.minimumAverage });
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!data || !form || running.current) return;
    if (form.ratioPercent === null || form.ratioPercent < 0 || form.ratioPercent > 90 || form.minimumAverage === null || form.minimumAverage < 1 || form.minimumAverage > 1_000_000) { setError("비율은 0~90%, 최소 평균은 1~1,000,000 사이로 입력해 주세요."); return; }
    running.current = true; setBusy(true); setError(""); setSaved(false);
    try {
      const { subscribed, ...policy } = form;
      await api.post(`/site-alerts/${encodeURIComponent(siteId)}`, { ...(data.canEdit && { settings: policy }), subscribed, expectedGeneration: data.generation, expectedSubscriptionGeneration: data.subscriptionGeneration }, { headers: { "X-CSRF-Token": data.csrfToken ?? "" } });
      await load(); if (mounted.current && actor.current === siteId) setSaved(true);
    } catch (cause) {
      if (mounted.current && actor.current === siteId) { setError(errorMessage(cause)); if (cause instanceof ApiError && cause.code === "alert_changed") await load().catch(() => {}); }
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  };
  const footer = <><Button variant="secondary" onClick={onClose} disabled={busy}>닫기</Button>{data && (data.canEdit || data.subscribed) && <Button type="submit" form="site-alert-form" loading={busy}>알림 설정 저장</Button>}</>;
  return <Modal open title={`${name} · 급감 알림`} description="사이트별로 직접 켜고, 내 계정 이메일로만 받아요. 기본은 꺼져 있어요." onClose={() => { if (!busy) onClose(); }} footer={footer}>
    {!data || !form ? <>{error ? <p className="field-error" role="alert">{error}</p> : <LoadingState pattern="detail" />}</> : <form id="site-alert-form" className="stack" onSubmit={(event) => void save(event)}>
      <div className="row row-wrap"><Badge tone={!form.enabled ? "neutral" : data.mailConfigured ? "success" : "warn"}>{!form.enabled ? "감지 꺼짐" : data.mailConfigured ? "감지 사용" : "메일 준비 중"}</Badge><span className="text-caption">소유자·편집자 자기 구독만 사용해요.</span></div>
      {!data.mailConfigured && <p className="text-secondary">메일 발신 설정을 준비하고 있어요. 기준과 구독은 저장할 수 있고, 준비 전에는 메일을 보내지 않아요.</p>}
      <Checkbox label="이 사이트의 급감 감지 사용" checked={form.enabled} disabled={!data.canEdit || busy} onChange={(event) => change("enabled", event.target.checked)} />
      <Select label="감지 지표" value={form.metric} disabled={!data.canEdit || busy} onChange={(event) => metric(event.target.value as SiteAlertMetric)}><option value="pageviews">페이지뷰</option><option value="conversions">전환 수</option></Select>
      <NumberField label="기준 평균 대비 이 비율 이하일 때" value={form.ratioPercent} onChange={(value) => change("ratioPercent", value)} suffix="%" hint={`기본 20%는 80% 이상 감소예요.${form.ratioPercent === null ? "" : ` 현재 ${100 - form.ratioPercent}% 이상 감소를 확인해요.`}`} disabled={!data.canEdit || busy} required />
      <NumberField label={`기준 기간의 최소 일평균 ${metricLabel(form.metric)}`} value={form.minimumAverage} onChange={(value) => change("minimumAverage", value)} hint="기본은 페이지뷰 100건/일, 전환 10건/일이에요. 표본이 작으면 기다려요." disabled={!data.canEdit || busy} required />
      <Select label="연속 확인 기간" value={form.confirmationDays} disabled={!data.canEdit || busy} onChange={(event) => change("confirmationDays", Number(event.target.value))}><option value={1}>완료된 1일</option><option value={2}>완료된 2일 · 기본</option><option value={3}>완료된 3일</option></Select>
      <p className="text-caption">매일 09:00 KST에 오늘을 제외한 완료 기간과 그전 7일 평균을 비교해요. 전주 같은 요일보다도 감소해야 알리고, 구성원 방문은 제외해요. 첫 이벤트가 기준 기간보다 최근이거나 전주 기준이 0이면 이력이 쌓일 때까지 기다려요.</p>
      <Checkbox label="내 계정 이메일로 받기" checked={form.subscribed} disabled={busy || !data.eligible && !form.subscribed} onChange={(event) => change("subscribed", event.target.checked)} />
      <p className="text-caption">받는 계정: {data.email}<br />사이트·내 계정별 7일에 한 번까지 발송을 시도해요. 감지나 구독을 껐다 켜도 제한은 유지돼요.{data.cooldownUntil && data.cooldownUntil > Date.now() && <> 다음 가능 시각: {date(data.cooldownUntil)}</>}</p>
      {!data.eligible && <p className="text-secondary">현재 역할에서는 받기를 켤 수 없어요. 기존 구독은 해제할 수 있어요.</p>}
      {data.lastCheck && <p className="text-caption">최근 검사: {date(data.lastCheck.checkedAt)} · {data.lastCheck.result === "low" ? "급감 기준 해당" : data.lastCheck.result === "normal" ? "기준 이내" : "기준 데이터 대기"}<br />기간 {data.lastCheck.targetStart} ~ {data.lastCheck.targetDay}, 기준 7일 평균 {(data.lastCheck.baselineSum / 7).toFixed(1)} · 일별 {data.lastCheck.target.join(", ")}</p>}
      {data.lastMail && <p className="text-caption">최근 메일: {mailStatus[data.lastMail.status] ?? "상태 확인 필요"} · {date(data.lastMail.at)}{data.lastMail.errorCode === "recovered" && " · 최신 집계가 회복되어 보내지 않았어요."}</p>}
      {saved && <p className="text-success" role="status">설정을 저장했어요.{!data.mailConfigured && " 메일 준비 전에는 발송하지 않아요."}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>}
  </Modal>;
}
