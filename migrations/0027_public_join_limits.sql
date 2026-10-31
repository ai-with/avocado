-- AIWITH-292: 공개 가이드 참여의 IP/가이드별 고정 시간창 시도 예약.
-- key는 도메인·범위·시간창을 분리한 HMAC이며 원문 IP/연락처/토큰을 저장하지 않는다.
CREATE TABLE public_join_limits (
  key text PRIMARY KEY NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  expires_at integer NOT NULL
);
CREATE INDEX public_join_limits_expiry_idx ON public_join_limits(expires_at, key);
