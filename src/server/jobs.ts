// Cron(*/15)과 Queue(avocado-pipeline) 작업 등록부. 후속 워커가 한 줄씩 추가한다
export type ScheduledTask = (env: Env, controller: ScheduledController) => Promise<void>;
export type PipelineMessage = { type: string; payload: unknown };
export type QueueHandler = (payload: unknown, env: Env) => Promise<void>;

export const scheduledTasks: ScheduledTask[] = [];
export const queueHandlers: Record<string, QueueHandler> = {};
// 메시지 하나씩이 아니라 배치 전체를 받는 큐(큐 이름으로 찾는다)
export type BatchQueueHandler = (batch: MessageBatch<PipelineMessage>, env: Env) => Promise<void>;
export const batchQueueHandlers: Record<string, BatchQueueHandler> = {};

// TASK-018: 24시간 넘은 미완료 업로드 정리. process_submission 소비자는 TASK-020 이 queueHandlers 에 붙인다
import { abortStaleUploads } from "./routes/public-guide";
scheduledTasks.push(abortStaleUploads);

// TASK-021: 자동 발송 대기열(due 지난 run)과 예약된 1회성 발송 처리
import { processMessaging } from "./lib/messaging";
scheduledTasks.push(processMessaging);

// TASK-020: 업로드 완료 후 처리 파이프라인 (F-60, F-61)
import { processSubmission } from "./pipeline";
queueHandlers.process_submission = processSubmission;

// TASK-022: 스냅샷 수집(F-48)과 댓글 키워드 DM 대기열 재시도(F-64). 게시물 URL 등록 시 스냅샷 예약
import { processSnapshotCollection, runDueSnapshots, scheduleSnapshots } from "./lib/snapshots";
import { retryQueuedDms } from "./lib/keyword-dm";
import { contentHooks } from "./lib/contents";
scheduledTasks.push(async (env) => void (await runDueSnapshots(env)), retryQueuedDms);
contentHooks.onContentRegistered = (env, db, content) => scheduleSnapshots(db, env, content.id, { reset: true, expectedRevision: content.collectionRevision });
queueHandlers.collect_snapshot = processSnapshotCollection;

// AIWITH-303: 인증 보조 테이블 정리와 테이블별 삭제 건수 기록 (03:00 KST)
import { cleanupAuthRecords } from "./lib/auth-cleanup";
scheduledTasks.push(cleanupAuthRecords);

// TASK-029: 웹 SDK 수집 큐 소비자, 이벤트 중복 제거 기록 정리, 기존 리드 이메일 해시 채우기
import { consumeCollect, pruneEventIds } from "./lib/collect/consume";
import { backfillEmailHashes } from "./lib/leads";
batchQueueHandlers["avocado-collect"] = consumeCollect;
scheduledTasks.push(pruneEventIds, backfillEmailHashes);

// AIWITH-283: 개인정보 작업별 Queue 호출로 Cron과 D1/R2 호출 예산을 분리한다.
import { enqueuePrivacyPurges, processPrivacyPurge } from "./lib/privacy-jobs";
scheduledTasks.push(enqueuePrivacyPurges);
queueHandlers.privacy_purge = processPrivacyPurge;

// AIWITH-284: URL 세대 교체 중 실패한 썸네일 보상과 내보내기 임시 자료 정리도 별도 호출로 처리한다.
import { enqueueThumbnailSweep, processThumbnailCleanup, processThumbnailSweep } from "./lib/content-thumbnail";
import { cleanupGoogleSheetsJobs, enqueueGoogleSheetsCleanup } from "./lib/google-sheets-export";
import { cleanupPublicJoinLimits } from "./lib/guide-join";
queueHandlers.cleanup_content_thumbnail = processThumbnailCleanup;
queueHandlers.sweep_content_thumbnails = processThumbnailSweep;
queueHandlers.cleanup_google_sheets = async (_payload, env) => {
  await cleanupGoogleSheetsJobs(env);
  await cleanupPublicJoinLimits(env); // 기존 정리 Queue를 재사용하며 추가 D1 호출은 bounded DELETE 1회다.
};
scheduledTasks.push(enqueueGoogleSheetsCleanup, enqueueThumbnailSweep);

// AIWITH-285: 연결 발견·연결 한 건 확인·수신자 한 명 발송을 각각 독립 호출로 실행한다.
import { enqueueIgConnectionMaintenance, processIgConnectionCheck, processIgConnectionMaintenance, processIgDisconnectMail } from "./lib/ig-disconnect-mail";
scheduledTasks.push(enqueueIgConnectionMaintenance);
// Drizzle 오류의 bound params에는 메일 주소가 있을 수 있다. 실패·재시도는 유지하고 원문 로그는 막는다.
const instagramQueue = (handler: QueueHandler): QueueHandler => async (payload, env) => {
  try { await handler(payload, env); }
  catch { throw new Error("instagram_queue_job_failed"); }
};
queueHandlers.ig_connection_maintenance = instagramQueue(processIgConnectionMaintenance);
queueHandlers.check_ig_connection = instagramQueue(processIgConnectionCheck);
queueHandlers.ig_disconnect_mail = instagramQueue(processIgDisconnectMail);

// AIWITH-388: public reference rates are fetched outside collect/request paths.
import { enqueueFxRefresh, refreshFxRates } from "./lib/site-fx";
scheduledTasks.push(enqueueFxRefresh);
queueHandlers.site_fx_refresh = refreshFxRates;
