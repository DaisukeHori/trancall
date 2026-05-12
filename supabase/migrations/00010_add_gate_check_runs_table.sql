-- 00010_add_gate_check_runs_table.sql
-- Gate Check 実行結果を永続化するテーブル (PERF-002 計測 T-31)
-- 設計参照: docs/production-runbook.md §15 (Gate Check runbook)

CREATE TABLE IF NOT EXISTS trancall_translation.gate_check_runs (
  run_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  scenario_count  INT         NOT NULL DEFAULT 0,
  pass_count      INT         NOT NULL DEFAULT 0,
  p50_ms          NUMERIC(10, 2),
  p95_ms          NUMERIC(10, 2),
  p99_ms          NUMERIC(10, 2),
  memory_mb_max   NUMERIC(10, 2),
  verdict         TEXT        NOT NULL CHECK (verdict IN ('PASS', 'CONDITIONAL_PASS', 'FAIL', 'PENDING')),
  dry_run         BOOLEAN     NOT NULL DEFAULT FALSE,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE trancall_translation.gate_check_runs IS
  'Phase 1a Gate Check (PERF-002) 実行結果。production-runbook.md §15 参照。';

COMMENT ON COLUMN trancall_translation.gate_check_runs.verdict IS
  'PASS: p95 < 3000ms かつ pass_count >= 99 / CONDITIONAL_PASS: p95 < 3500ms かつ pass_count >= 95 / FAIL: 上記以外 / PENDING: 実行中';

-- RLS: service_role のみ書き込み、閲覧はサービス内部のみ
ALTER TABLE trancall_translation.gate_check_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY gate_check_runs_service_only
  ON trancall_translation.gate_check_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
