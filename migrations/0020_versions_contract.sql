-- TASK-074: 업로드 버전 = 완성본 기준. 클린본은 올린 시점의 가장 최근 완성본 버전에 붙는다(완성본이 없으면 v1).
-- 같은 버전에 클린본이 여러 개면 조회에서 가장 최근 것만 쓴다(행은 지우지 않는다). 여러 번 돌려도 결과가 같다
UPDATE submissions
SET version = COALESCE(
  (
    SELECT MAX(f.version)
    FROM submissions AS f
    WHERE f.guide_influencer_id = submissions.guide_influencer_id
      AND f.kind = 'final'
      AND f.status NOT IN ('uploading', 'aborted')
      AND COALESCE(f.uploaded_at, f.created_at) <= COALESCE(submissions.uploaded_at, submissions.created_at)
  ),
  1
)
WHERE kind = 'clean';

-- 계약 기간(ms, 비어 있을 수 있음). 공개 화면 마감일은 계약 종료일을 먼저 쓴다
ALTER TABLE guide_influencers ADD COLUMN contract_start_at INTEGER;
ALTER TABLE guide_influencers ADD COLUMN contract_end_at INTEGER;
