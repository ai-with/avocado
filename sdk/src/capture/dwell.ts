/** 화면이 보이는 시간만 센다 (visibilitychange 기준, docs/04 F-51 정책과 같다) */
export class DwellTimer {
  private visibleMs = 0;
  private visibleSince: number | null;

  constructor(now: number, visible: boolean) {
    this.visibleSince = visible ? now : null;
  }

  onVisibilityChange(now: number, visible: boolean): void {
    if (visible) {
      this.visibleSince ??= now;
      return;
    }
    if (this.visibleSince !== null) this.visibleMs += now - this.visibleSince;
    this.visibleSince = null;
  }

  /** 지금까지 쌓인 보이는 시간을 꺼내고 0부터 다시 센다. 여러 번 보내도 서버 합계가 맞게 */
  take(now: number): number {
    const total = this.visibleMs + (this.visibleSince === null ? 0 : now - this.visibleSince);
    this.visibleMs = 0;
    if (this.visibleSince !== null) this.visibleSince = now;
    return total;
  }
}
