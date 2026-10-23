import { useCallback, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../useInViewPlayback";

const VISIBLE_RATIO = 0.4;

export type DemoStep = { at: number };

// 데모 단계 진행. steps[i].at(ms, 시작 기준)에 step이 i가 된다. 시작 전은 -1.
// 화면에 40% 이상 보이면 한 번 자동 재생하고, 이후에는 replay로만 다시 돈다.
// 움직임 줄이기면 마지막 단계를 바로 보여 준다
export function useDemoSequence<T extends HTMLElement = HTMLDivElement>(steps: readonly DemoStep[]) {
  const [step, setStep] = useState(-1);
  const ref = useRef<T>(null);
  const timers = useRef<number[]>([]);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const replay = useCallback(() => {
    clear();
    const all = stepsRef.current;
    if (prefersReducedMotion()) {
      setStep(all.length - 1);
      return;
    }
    setStep(-1);
    timers.current = all.map((s, i) => window.setTimeout(() => setStep(i), s.at));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return clear;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      replay();
    }, { threshold: VISIBLE_RATIO });
    observer.observe(el);
    return () => { observer.disconnect(); clear(); };
  }, [replay]);

  const last = steps.length - 1;
  return { step, replay, ref, done: step >= last, running: step >= 0 && step < last };
}

// 시간 간격 배열을 누적 시각 단계로 바꾼다. [300, 500] → [{at:300},{at:800}]
export function stepsFromGaps(gaps: readonly number[]): DemoStep[] {
  let at = 0;
  return gaps.map((gap) => ({ at: (at += gap) }));
}
