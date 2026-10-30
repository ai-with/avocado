// 브랜드·캠페인 규칙 (TASK-070). 서버 삭제 API 와 설정 화면이 같이 쓴다

// 브랜드를 지울 수 없는 이유. 지울 수 있으면 null
export function brandDeleteBlock(campaignCount: number, liveBrandCount: number): string | null {
  if (campaignCount > 0) return `이 브랜드에 캠페인이 ${campaignCount}개 있어요. 캠페인을 다른 브랜드로 옮긴 뒤 삭제할 수 있어요.`;
  if (liveBrandCount <= 1) return "브랜드는 하나 이상 있어야 해요.";
  return null;
}
