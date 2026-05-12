-- =============================================================================
-- 00011: trancall_audit.retention_runs テーブル追加
-- T-60: 日次 retention 削除バッチの実行記録
-- docs/production-runbook.md §10 canonical
-- =============================================================================

-- trancall_audit スキーマ作成 (初回のみ)
CREATE SCHEMA IF NOT EXISTS trancall_audit;

-- =============================================================================
-- trancall_audit.retention_runs
-- retention-cleanup Edge Function の実行ごとに 1 行追記する監査ログ。
-- 削除件数の時系列推移や障害記録として利用する。
-- =============================================================================

CREATE TABLE trancall_audit.retention_runs (
  run_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ NOT NULL,
  -- deletion_counts JSONB 構造例:
  -- {
  --   "segments": 42,
  --   "transcript_access": 3,
  --   "agent_metrics": 1200,
  --   "external_purchase_tokens": 0,
  --   "webhook_events": 87,
  --   "usage_reservations": 5,
  --   "deleted_auth_users": 1
  -- }
  deletion_counts JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- errors: エラーが発生した場合のみ設定。正常終了時は NULL。
  errors          TEXT[]
);

-- 直近ランを時系列で検索しやすくするインデックス
CREATE INDEX idx_retention_runs_started_at
  ON trancall_audit.retention_runs(started_at DESC);

-- =============================================================================
-- RLS: service_role のみ書き込み可 / authenticated は参照不可
-- (内部監査テーブルのため全アクセスを制限)
-- =============================================================================
ALTER TABLE trancall_audit.retention_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY retention_runs_service_only
  ON trancall_audit.retention_runs
  FOR ALL
  USING (FALSE);

-- =============================================================================
-- コメント
-- =============================================================================
COMMENT ON TABLE trancall_audit.retention_runs IS
  '日次 retention 削除バッチ (supabase/functions/retention-cleanup) の実行記録。'
  '1 ラン = 1 行。deletion_counts に各テーブルの削除件数、errors に失敗詳細を格納する。';

COMMENT ON COLUMN trancall_audit.retention_runs.run_id IS
  'Edge Function 内で crypto.randomUUID() で生成した実行 ID。';

COMMENT ON COLUMN trancall_audit.retention_runs.deletion_counts IS
  'テーブル名 → 削除件数 の JSONB マップ。'
  'キー: segments / transcript_access / agent_metrics / external_purchase_tokens'
  ' / webhook_events / usage_reservations / deleted_auth_users';

COMMENT ON COLUMN trancall_audit.retention_runs.errors IS
  '部分失敗時のエラーメッセージ配列。全成功時は NULL。'
  'production-runbook.md §14.6 retention_batch_failure 対応で参照する。';
