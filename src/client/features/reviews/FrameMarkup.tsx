import { useId, useRef, useState, type PointerEvent } from "react";
import type { FeedbackShape } from "../../../shared/review";

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const MIN_SHAPE_SIZE = 0.02;
const clamp = (v: number) => Math.min(1, Math.max(0, v));

// 프레임 이미지 위 박스·화살표 표시. 좌표는 이미지 대비 0~1 비율 (F-62). onDraw 가 있으면 그릴 수 있다
export function FrameMarkup({ src, shapes, tool, onDraw, alt }: { src: string; shapes: FeedbackShape[]; tool?: FeedbackShape["type"]; onDraw?: (s: FeedbackShape) => void; alt: string }) {
  const { svg, drag, down, move, up, cancel } = useDrawShape(tool, onDraw);
  const marker = `arrow-${useId().replace(/:/g, "")}`;

  return (
    <div className="markup">
      <img src={src} alt={alt} draggable={false} />
      <svg ref={svg} className={onDraw ? "is-drawing" : undefined} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
        <defs>
          <marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {[...shapes, ...(drag ? [drag] : [])].map((s, i) => <ShapeMark key={i} s={s} marker={marker} />)}
      </svg>
    </div>
  );
}

// 포인터 드래그로 박스·화살표 하나를 그린다
function useDrawShape(tool: FeedbackShape["type"] | undefined, onDraw: ((s: FeedbackShape) => void) | undefined) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<FeedbackShape | null>(null);

  const point = (e: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (!onDraw || !tool) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    setDrag({ type: tool, x: p.x, y: p.y, w: 0, h: 0 });
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const p = point(e);
    setDrag({ ...drag, w: p.x - drag.x, h: p.y - drag.y });
  };
  const up = () => {
    if (!drag) return;
    // 너무 작은 표시는 클릭으로 보고 버린다
    if (Math.hypot(drag.w, drag.h) > MIN_SHAPE_SIZE) onDraw?.(drag.type === "box" ? normBox(drag) : drag);
    setDrag(null);
  };
  return { svg, drag, down, move, up, cancel: () => setDrag(null) };
}

function ShapeMark({ s, marker }: { s: FeedbackShape; marker: string }) {
  if (s.type === "box") return <rect x={pct(Math.min(s.x, s.x + s.w))} y={pct(Math.min(s.y, s.y + s.h))} width={pct(Math.abs(s.w))} height={pct(Math.abs(s.h))} />;
  return <line x1={pct(s.x)} y1={pct(s.y)} x2={pct(s.x + s.w)} y2={pct(s.y + s.h)} markerEnd={`url(#${marker})`} />;
}

function normBox(s: FeedbackShape): FeedbackShape {
  return { type: "box", x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) };
}
