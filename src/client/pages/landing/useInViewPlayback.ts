import { useEffect, useRef } from "react";

const VISIBLE_RATIO = 0.4;
export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 화면에 들어올 때만 재생해 데이터를 아낀다. enabled가 false면 손대지 않는다(움직임 줄이기, 사용자가 멈춤)
export function useInViewPlayback(enabled: boolean) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || !enabled) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void video.play().catch(() => undefined);
      else video.pause();
    }, { threshold: VISIBLE_RATIO });
    observer.observe(video);
    return () => observer.disconnect();
  }, [enabled]);
  return ref;
}
