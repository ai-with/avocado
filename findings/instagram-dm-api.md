# 인스타그램 브랜드 계정에서 인플루언서에게 먼저 DM을 보낼 수 있는가 (조사 2026-10-27)

## 결론
1. 공식 Instagram Messaging API로는 대화 이력이 없는 인플루언서에게 브랜드가 먼저 DM을 보낼 수 없다. 상대가 먼저 메시지를 보내거나 댓글, ig.me 링크 클릭 같은 행동을 해야 24시간 창이 열린다. 근거: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api
2. 브랜드가 먼저 연락하는 공식 경로는 Instagram 크리에이터 마켓플레이스(앱 화면, 2024-05 한국 포함)뿐이다. 공개된 Creator Marketplace API(2025-10 GA)는 크리에이터 검색·인사이트만 있고 메시지·제안 발송 엔드포인트는 문서에 없다. 근거: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/creator-marketplace , https://www.facebook.com/business/news/instagram/creatormarketplaceexpansion
3. 스크래핑·비공식 API 자동 발송은 약관 4.2조 위반으로 계정 해지 위험이 있어 쓰지 않는다. 근거: https://www.facebook.com/help/instagram/581066165581870

## 공식 API로 가능한 것
| 수단 | 조건 | 근거 |
|---|---|---|
| 24시간 창 안 답장 | 사용자가 먼저 메시지 | messaging-api 문서 |
| Private Reply | 내 게시물 댓글 1건당 비공개 답장 1회, 댓글 후 7일 안 | https://developers.facebook.com/docs/instagram-platform/private-replies |
| Human Agent 태그 | 사람이 7일 안에 수동 답장, 별도 권한 검수, 홍보성 금지 | https://developers.facebook.com/docs/messenger-platform/send-messages |
| ig.me 링크 + ref | 인플루언서가 눌러 대화를 열면 ref가 웹훅으로 옴(Ice Breakers 필요) | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/ig-me |

## avocado 적용
- 첫 컨택 DM: 템플릿을 변수로 채워 복사해 브랜드가 직접 보내고 '보냄'으로 기록(AIWITH-484, 사용자 결정)
- 이후 자동화 후보: 가이드 링크에 ig.me 'DM 보내기' 버튼(ref=캠페인), 댓글 키워드 DM(기존 기능)으로 24시간 창을 연 뒤 공식 API 답장

## 확인 못 한 것
- Instagram 전용 메시지 태그 전체 목록, Creator Marketplace API 국가 제한, 우선 DM·프로젝트 브리프 API의 일반 공개 여부
