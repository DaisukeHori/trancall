-- =============================================================================
-- 00023: trancall_event.agent_request_nonces テーブル追加 (Issue #63)
-- Agent → Server HMAC リクエストの idempotencyKey 単位でのリプレイ対策 nonce store。
-- =============================================================================
--
-- 背景:
--   apps/server/src/middleware/hmac-middleware.ts の #25 残課題 TODO:
--   x-trancall-idempotency-key ヘッダー単位でのリクエスト重複排除 (nonce store) が
--   未実装だった。docs/module-contracts.md §7.3 に記載の「event type ごとの DB
--   UNIQUE 制約」(translation_sessions.agent_job_id / transcript.segments の
--   UNIQUE(room_id, participant_id, sequence_no)) は「同一イベントの重複処理」を
--   防ぐが、以下の 2 点はカバーしない:
--     1. translation.degraded / translation.recovered は DB に永続化せず
--        EventBus.publish のみを行う (apps/server/src/routes/agent-routes.ts) ため、
--        イベント種別固有の UNIQUE 制約による重複排除が全く効かない。
--        署名・timestamp をそのまま使い回すリプレイが行われると、同じ
--        translation.degraded/recovered が EventBus に複数回 publish されうる。
--     2. agent.metrics / heartbeat は「重複は許容」(§7.3) とされているが、
--        署名の単純リプレイ (盗聴した正当なリクエストの再送) まで許容する
--        必要はない。
--
-- 設計:
--   idempotency_key (x-trancall-idempotency-key ヘッダーの値、Agent 実装は
--   常に randomUUID() を新規生成するが、DB 列は将来の形式変更に備えて
--   TEXT とする) を PRIMARY KEY とする。
--   processed_at は「このリクエストの実処理が正常完了したか」を表す:
--     - NULL: 未処理 (初回 INSERT 直後、または前回処理が完了前に失敗した状態)。
--       Agent 側の internal-api-client.ts は同一 idempotencyKey / timestamp /
--       signature を使い回してリトライする (network エラー・5xx のみ、4xx は
--       リトライしない) ため、processed_at が NULL のままの nonce に対する
--       再送は「正当なリトライ」として再処理を許可する必要がある。
--     - NOT NULL: 処理完了済み。以後の同一 idempotencyKey リクエスト
--       (リトライまたはリプレイ) は再処理せず、既に完了した結果 (200 OK) を
--       返すだけにする (副作用の二重実行防止)。
--   expires_at は署名の鮮度ウィンドウ (TIMESTAMP_TOLERANCE_MS = 5分、
--   hmac-middleware.ts) が終わる時刻を格納し、期限切れ nonce の掃除
--   (定期 DELETE) に使う。ウィンドウを過ぎた timestamp は HMAC ミドルウェアの
--   鮮度チェック自体で 401 になるため、そのタイミング以降このテーブルの行は
--   再利用されず安全に削除できる。
--
-- 掃除:
--   本 migration では自動掃除ジョブ (pg_cron) は追加しない。
--   `DELETE FROM trancall_event.agent_request_nonces WHERE expires_at < now()`
--   を運用上のバッチ (または将来の pg_cron ジョブ、00012 のパターンを参照) で
--   定期実行する想定。
-- =============================================================================

CREATE TABLE trancall_event.agent_request_nonces (
  idempotency_key TEXT        PRIMARY KEY,
  expires_at      TIMESTAMPTZ NOT NULL,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 期限切れ nonce の掃除バッチ用インデックス
CREATE INDEX idx_agent_request_nonces_expires_at
  ON trancall_event.agent_request_nonces (expires_at);

COMMENT ON TABLE trancall_event.agent_request_nonces IS
  'Agent → Server HMAC リクエストの idempotencyKey 単位リプレイ対策 nonce store (Issue #63)。'
  'processed_at IS NULL は未処理 (Agent の正当なリトライを許可)、'
  'processed_at IS NOT NULL は処理完了済み (以後の同一キーは再処理せず 200 を返す)。';

ALTER TABLE trancall_event.agent_request_nonces ENABLE ROW LEVEL SECURITY;

-- 通常ユーザーはアクセス不可 (service_role のみ、他の trancall_event.* テーブルと同方針)
CREATE POLICY agent_request_nonces_service_only
  ON trancall_event.agent_request_nonces
  FOR ALL
  USING (FALSE);
