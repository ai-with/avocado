import { EmptyState, PageHeader } from "../ui";

// 후속 워커가 실제 화면으로 교체하는 자리
export function Placeholder({ title, description }: { title: string; description?: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title="준비 중입니다" description={description ?? "이 화면은 곧 열립니다."} />
    </>
  );
}
