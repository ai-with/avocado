import { CopyButton, SectionCard } from "../../../ui";

// 브랜드 개인정보처리방침에 넣을 예시 문구 (docs/14 7장). 법률 검토 전 예시라 그대로 쓰기 전에 확인을 권한다
const POLICY_TEXT = `[행태정보의 수집·이용 및 거부 방법]
회사는 서비스 이용 분석과 마케팅 성과 측정을 위해 아보카도(웹 분석 도구)를 이용해 아래 행태정보를 수집합니다.
1. 수집 항목: 방문 페이지 주소, 페이지 열람·스크롤 도달·클릭 기록, 체류 시간, 유입 경로(리드 링크 클릭 ID, UTM), 접속 국가, 기기 유형
2. 수집 방법: 웹사이트 방문 시 자동 수집 (1st-party 쿠키 _avc, 브라우저 저장소 avc_attr, avc_q, avc_id)
3. 보유 기간: 원본 이벤트 3개월, 방문 요약 13개월
4. 처리 위탁: 아보카도(수탁자), 재위탁 Cloudflare(국외 저장 가능)
5. 거부 방법: 브라우저 설정에서 쿠키 저장을 거부하거나 사이트의 동의 설정에서 분석 수집을 거부할 수 있습니다. 비밀번호·카드 정보 등 입력값은 수집하지 않습니다.`;

export function PrivacyNotice() {
  return (
    <SectionCard
      title="개인정보처리방침 예시 문구"
      description="스크립트를 설치하는 사이트의 처리방침에 행태정보 수집 사실을 알려야 해요. 아래는 예시이며 법률 검토 후 사이트 상황에 맞게 고쳐 쓰세요."
      actions={<CopyButton text={POLICY_TEXT} label="문구 복사" doneMessage="예시 문구를 복사했어요." />}
    >
      <pre className="site-policy">{POLICY_TEXT}</pre>
    </SectionCard>
  );
}
