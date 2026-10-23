import { useEffect, useState, type RefObject } from "react";

// timeupdate는 초당 4번 정도라 진행 바가 끊겨 보인다. 재생 중에만 매 프레임 currentTime을 읽는다
export function useReelClock(ref: RefObject<HTMLVideoElement | null>) {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let frame = 0;
    const sync = () => setTime(video.currentTime);
    const tick = () => { sync(); frame = requestAnimationFrame(tick); };
    const start = () => { cancelAnimationFrame(frame); tick(); };
    const stop = () => { cancelAnimationFrame(frame); sync(); };
    video.addEventListener("playing", start);
    video.addEventListener("pause", stop);
    video.addEventListener("seeked", sync);
    if (!video.paused) start();
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("playing", start);
      video.removeEventListener("pause", stop);
      video.removeEventListener("seeked", sync);
    };
  }, [ref]);
  return time;
}

export const formatClock = (seconds: number) => `00:${String(Math.floor(seconds)).padStart(2, "0")}`;
