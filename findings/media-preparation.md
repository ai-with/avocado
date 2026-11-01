# 큰 영상 처리 방식 선정 (AIWITH-378, 2026-11-01)

압축·서버 오디오 추출은 **Cloudflare Containers + FFmpeg**로 구현한다. 원본은 기존 R2에 보존하고 앱이 허용한 비공개 바이트 스트림을 처리기에 전달한다. MP4 재생 사본과 STT용 16kHz mono PCM WAV를 반환한다. 아키텍처 선정이며 운영 활성화·성능 실측 완료는 아니다. AIWITH-379·380의 구현·배포·실제 큰 영상 검증은 별도다.

## 비용 비교

| 항목 | Stream | Containers |
|---|---|---|
| 처리·저장 | 인코딩·업로드 무료, 저장 용량 1,000분마다 월 $5 선불 | Workers Paid 필요. 메모리·CPU·디스크 사용량 과금 |
| 전달 | 1,000분마다 $1, MP4 다운로드 포함 | 지역별 전송 비용, Workers·DO·로그 비용 별도 |
| 출력 | 비동기 MP4·M4A 생성. 현재 WAV 입력에는 추가 변환 필요 | 원하는 H.264/AAC MP4·PCM WAV 규격을 직접 생성 |
| 데이터 수명 | R2 원본 외 Stream UID·사본의 접근·삭제 추적 필요 | 기존 R2에 불변 사본 키·선택·파기 원장 추가 |

Containers 포함량은 월 메모리 25GiB-hours·CPU 375vCPU-minutes·디스크 200GB-hours다. 초과 단가는 각각 GiB-second당 $0.0000025, vCPU-second당 $0.000020, GB-second당 $0.00000007이다. 측정 후보인 `basic`은 ¼vCPU·1GiB 메모리·4GB 디스크다. CPU를 모두 사용하며 180초 실행하면 세 항목의 초과분은 약 $0.0014004다. 기동·대기·전송·Workers·DO·로그·저장 비용과 포함량을 제외한 계산이며 **건당 견적이나 예산이 아니다**. `lite`의 2GB 디스크에는 2GiB 원본과 이미지·출력·작업 공간을 함께 둘 수 없다. basic의 적합성도 Linux에서 측정한다.

근거: [Stream 요금](https://developers.cloudflare.com/stream/pricing/), [Containers 요금](https://developers.cloudflare.com/containers/platform/pricing/), [인스턴스·제한](https://developers.cloudflare.com/containers/platform/limits/). 가격·API는 2026-11-01 공식 문서를 확인했다.

비공개 `exec()` 프로토타입은 [Durable Object Container API](https://developers.cloudflare.com/containers/api/durable-object-container/)의 `durable_object` 정책을 쓴다. 이 API 문서와 저장소에 고정된 Workers 타입의 명명된 크기는 `lite`, `standard-1` 이상이며 `basic`은 나열되어 있지 않다. 따라서 이 프로토타입은 **standard-1(½vCPU·4GiB·8GB)**을 사용한다. 같은 180초 계산의 세 항목 초과분은 약 **$0.0037008**이며 부대비용·포함량·실측 조건은 위와 같다. basic 계산은 일반 인스턴스 요금 비교용이다. 실제 배포 제안은 사용하는 API 정책과 인스턴스 크기를 함께 명시해야 한다.

## 처리 시간 비교

| 단계 | Stream | Containers + FFmpeg |
|---|---|---|
| 입력 | Stream으로 원본 전달 | 냉기동 후 비공개 스트림을 seek 가능한 디스크에 최대 2GiB spool |
| 준비 | Stream 업로드·인코딩 완료 대기 | ffprobe로 구조·duration·트랙 검사 (제안 상한 10초) |
| 변환 | MP4·M4A export 생성 요청 후 ready까지 비동기 조회 | MP4·WAV 생성, 프로세스별 제안 상한 180초·처리기 전체 240초 |
| 앱 반영 | 다운로드 후 M4A→WAV 변환 및 앱 저장 | 출력 스트림 반환 후 앱 R2 저장·동의/generation 검사·원자적 선택 |
| 실제 지연 | 인코딩·export·추가 변환 시간 미측정 | 냉기동·전송·CPU throttling·변환 시간 미측정 |

Stream의 ready 조회는 [공식 다운로드 절차](https://developers.cloudflare.com/stream/viewing-videos/download-videos/)다. 양쪽의 고정 완료 시간이나 성능 우위를 뒷받침하는 실측은 없다. Container 상한은 실패를 종료하는 실행 예산이며, 180초 영상을 180초 안에 처리한다는 보장이 아니다. 입력 길이 180초·업로드 2GiB는 앱 범위, 브라우저 500MiB는 오디오 디코딩 메모리 제한으로 서로 구분한다.

로컬 POC의 600MiB 입력은 1초 영상에 sparse MP4 free-box를 채운 파일이다. 스트리밍·정리 검증에는 쓰지만 실제 큰 영상의 처리 시간 비교나 Cloud 성능 추정에 사용하지 않는다.

## 선택 이유와 운영 적용 조건

현재 앱은 정확한 R2 원본과 WAV 전사 경로를 갖고 있다. 출력 규격을 직접 정하고 Stream 저장소의 영상 생명주기를 추가하지 않는 점 때문에 Containers를 선택한다. 더 빠르거나 더 싸다는 실측 결론으로 선택한 것은 아니다.

379·380에서는 아래 조건을 구현·확인한다.

1. 비공개 실행, 외부 네트워크 차단, 작업별 격리, 전송 크기·대기 시간 상한, 취소·전체 프로세스 종료. 앱의 R2/D1 자격증명·임의 URL은 처리기에 전달하지 않는다.
2. PUT 전 파기 원장 기록, 동의·원본 ETag·현재 generation을 재검사하는 원자적 선택. 응답 유실·늦은 결과가 선택된 사본을 삭제하거나 철회 파일을 되살리지 않아야 한다. 서버 오디오 반영 뒤 새 generation에서 STT를 시작한다.
3. 실제 내용이 있는 500MiB 초과 및 2GiB·180초 경계 파일로 냉기동·전송·변환·메모리·실패율·비용 측정. 원본 SHA 보존, 사본 우선 재생·실패 시 원본 복구, 오디오 없음과 추출 실패 구분, 철회 파기를 검증한다.
4. 측정 결과·인스턴스·동시 작업 수·월 사용 한도·배포/롤백 변경을 검토한 뒤 운영 리소스를 적용한다. 이 문서만으로 유료 리소스를 만들거나 기존 운영 경로를 바꾸지 않는다.
