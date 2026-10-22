// 알림톡 어댑터. 1단계는 대행사 연동 전이라 항상 not_connected 를 돌려준다
// TODO(2단계): 딜러사 API 연동, 발신 프로필 키 복호화, 템플릿 심사 상태 동기화, 크레딧 차감
export type AlimtalkMessage = { to: string; templateCode: string; variables: Record<string, string> };
export type AlimtalkResult = { delivered: true; id: string } | { delivered: false; reason: "not_connected" };

export async function send(_env: Env, _msg: AlimtalkMessage): Promise<AlimtalkResult> {
  return { delivered: false, reason: "not_connected" };
}
