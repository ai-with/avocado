import type { CSSProperties } from "react";
import "./LoadingState.css";

type Shape = "text" | "title" | "circle" | "rect";
type Props = { shape?: Shape; width?: number | string; height?: number | string; className?: string };

// 따로 쓰는 자리 표시 한 조각 (TDS Skeleton 모양). 장식이라 낭독기에는 숨긴다. 영역 전체 로딩은 LoadingState
// text 22 r9(부제), title 30 r11(제목), circle 40(아이콘·아바타), rect 64 r18(목록 줄·면). width·height 로 크기만 바꾼다
export function Skeleton({ shape = "text", width, height, className = "" }: Props) {
  const style: CSSProperties = { width, height };
  if (shape === "circle" && width !== undefined && height === undefined) style.height = width;
  return <span className={`skeleton skeleton-${shape} ${className}`.trim()} style={style} aria-hidden="true" />;
}
