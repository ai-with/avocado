import { channelLabel, SOURCE_TYPE_LABELS } from "../../../shared/leads";
import { toCsv } from "../../../shared/csv";
import type { filteredLeads, lookups } from "./shared";

// 리드 CSV 내보내기. 날짜는 한국 시간
const KST_OFFSET_MS = 9 * 3600_000;
const HEADER = ["이메일", "이름", "소속", "전화번호", "출처", "가이드", "인플루언서", "채널", "마케팅 동의", "알림톡 동의", "수신 거부", "첫 방문", "마지막 방문", "태그"];

type Rows = Awaited<ReturnType<typeof filteredLeads>>;
type Lookups = Awaited<ReturnType<typeof lookups>>;

const nameOf = (list: { id: string; name: string }[], id: string | null) => (id ? (list.find((x) => x.id === id)?.name ?? "") : "");
const kstDate = (ms: number | null) => (ms ? new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ") : "");
const yn = (b: boolean) => (b ? "Y" : "N");

export function leadsCsv(rows: Rows, lk: Lookups) {
  return toCsv([
    HEADER,
    ...rows.map(({ lead: l, facts }) => [
      l.email,
      l.name,
      l.company,
      l.phone,
      SOURCE_TYPE_LABELS[l.firstSource.type],
      nameOf(lk.guides, l.lastSource.guideId),
      nameOf(lk.influencers, l.lastSource.influencerId),
      l.lastSource.channelKey ? channelLabel(l.lastSource.channelKey, lk.channels) : "",
      yn(l.marketingOptIn),
      yn(l.alimtalkOptIn),
      kstDate(l.unsubscribedAt),
      kstDate(l.firstSource.at),
      kstDate(l.lastSource.at),
      facts.tagIds.map((t) => nameOf(lk.tags, t)).join("|"),
    ]),
  ]);
}
