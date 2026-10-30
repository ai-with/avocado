import type { IconName } from "../ui";

export type NavItem = { to: string; label: string; icon: IconName };

// Figma 와이어프레임(iijKKWNUl1g4IspxG6JDfK)의 LNB 그룹과 순서
export const NAV: { title?: string; items: NavItem[] }[] = [
  { items: [{ to: "/dashboard", label: "홈", icon: "house" }] },
  {
    title: "콘텐츠",
    items: [
      { to: "/dashboard/campaigns", label: "캠페인", icon: "megaphone" },
      { to: "/dashboard/influencers", label: "인플루언서", icon: "users" },
      { to: "/dashboard/reviews", label: "초안검수", icon: "clipboard-check" },
    ],
  },
  {
    title: "리드 수집",
    items: [
      { to: "/dashboard/links", label: "리드 링크", icon: "link" },
      { to: "/dashboard/forms", label: "신청 폼", icon: "clipboard-list" },
      { to: "/dashboard/keyword-dm", label: "자동 DM", icon: "message-circle" },
    ],
  },
  {
    title: "리드 관리",
    items: [
      { to: "/dashboard/leads", label: "리드", icon: "contact" },
      { to: "/dashboard/automations", label: "자동 발송", icon: "zap" },
      { to: "/dashboard/broadcasts", label: "1회성 발송", icon: "send" },
    ],
  },
  {
    title: "분석",
    items: [
      { to: "/dashboard/performance", label: "성과표", icon: "chart-column" },
      { to: "/dashboard/sites", label: "사이트 분석", icon: "globe" },
    ],
  },
];

export const ACCOUNT_LINKS: NavItem[] = [
  { to: "/dashboard/settings/workspace", label: "워크스페이스 · 팀", icon: "building-2" },
  { to: "/dashboard/settings/brands", label: "브랜드", icon: "tag" },
  { to: "/dashboard/settings/messages", label: "메시지 템플릿", icon: "message-circle" },
  { to: "/dashboard/settings/plan", label: "요금제 · 크레딧", icon: "credit-card" },
  { to: "/dashboard/settings/integrations", label: "연동", icon: "plug" },
  { to: "/dashboard/help", label: "도움 받기", icon: "circle-help" },
];
