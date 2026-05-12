-- gate-check-summary.sql
-- Gate Check 集計クエリ (PERF-002 / T-31)
-- 設計参照: docs/production-runbook.md §15.4 (集計 SQL)
--
-- 使い方:
--   psql "${SUPABASE_DB_URL}" -f scripts/gate-check-summary.sql
--   または Supabase Dashboard の SQL Editor に貼り付けて実行

-- -------------------------------------------------------
-- §15.4 準拠: p50 / p95 / p99 を agent_metrics から集計
-- -------------------------------------------------------
WITH latencies AS (
  SELECT
    jsonb_array_elements_text(latency_ms->'totalEndToEnd')::int AS latency_ms_value,
    source_lang || '-' || target_lang AS scenario_key
  FROM trancall_event.agent_metrics
  WHERE created_at > now() - INTERVAL '6 hours'
)
SELECT
  scenario_key,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms_value) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms_value) AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms_value) AS p99_ms,
  count(*) AS sample_size
FROM latencies
GROUP BY scenario_key
ORDER BY scenario_key;

-- -------------------------------------------------------
-- Gate Check 実行履歴の集計 (trancall_translation.gate_check_runs)
-- -------------------------------------------------------
SELECT
  run_id,
  started_at,
  ended_at,
  scenario_count,
  pass_count,
  p50_ms,
  p95_ms,
  p99_ms,
  memory_mb_max,
  verdict,
  dry_run,
  EXTRACT(EPOCH FROM (ended_at - started_at)) AS duration_seconds
FROM trancall_translation.gate_check_runs
ORDER BY started_at DESC
LIMIT 20;
