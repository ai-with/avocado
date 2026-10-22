import type { IconName } from "../ui";

export type NavItem = { to: string; label: string; icon: IconName };

// Figma 와이어프레임(iijKKWNUl1g4IspxG6JDfK)의 LNB 그룹과 순서
export const NAV: { title?: string; items: NavItem[] }[] = [
  { items: [{ to: "/", label: "홈", icon: "house" }] },
  {
    title: "콘텐츠",
    items: [
      { to: "/guides", label: "가이드", icon: "file-text" },
      { to: "/influencers", label: "인플루언서", icon: "users" },
      { to: "/reviews", label: "검수함", icon: "clipboard-check" },
    ],
  },
  {
    title: "리드 수집",
    items: [
      { to: "/links", label: "리드 링크", icon: "link" },
      { to: "/forms", label: "신청 폼", icon: "clipboard-list" },
      { to: "/keyword-dm", label: "댓글 키워드 DM", icon: "message-circle" },
    ],
  },
  {
    title: "리드 관리",
    items: [
      { to: "/leads", label: "리드", icon: "contact" },
      { to: "/automations", label: "자동 발송", icon: "zap" },
      { to: "/broadcasts", label: "1회성 발송", icon: "send" },
    ],
  },
  {
    title: "분석",
    items: [
      { to: "/performance", label: "성과표", icon: "chart-column" },
      { to: "/sites", label: "사이트 분석", icon: "globe" },
    ],
  },
];

export const ACCOUNT_LINKS: NavItem[] = [
  { to: "/settings/workspace", label: "워크스페이스 · 팀", icon: "building-2" },
  { to: "/settings/plan", label: "요금제 · 크레딧", icon: "credit-card" },
  { to: "/settings/integrations", label: "연동", icon: "plug" },
  { to: "/help", label: "도움 받기", icon: "circle-help" },
];
