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
import { runDueSnapshots, scheduleSnapshots } from "./lib/snapshots";
import { retryQueuedDms } from "./lib/keyword-dm";
import { contentHooks } from "./lib/contents";
scheduledTasks.push(async (env) => void (await runDueSnapshots(env)), retryQueuedDms);
contentHooks.onContentRegistered = (env, db, content) => scheduleSnapshots(db, env, content.id, { reset: true });

// AIWITH-303: 인증 보조 테이블 정리와 테이블별 삭제 건수 기록 (03:00 KST)
import { cleanupAuthRecords } from "./lib/auth-cleanup";
scheduledTasks.push(cleanupAuthRecords);

// TASK-029: 웹 SDK 수집 큐 소비자, 이벤트 중복 제거 기록 정리, 기존 리드 이메일 해시 채우기
import { consumeCollect, pruneEventIds } from "./lib/collect/consume";
import { backfillEmailHashes } from "./lib/leads";
batchQueueHandlers["avocado-collect"] = consumeCollect;
scheduledTasks.push(pruneEventIds, backfillEmailHashes);
