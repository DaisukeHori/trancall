-- =============================================================================
-- 00012: pg_cron による retention-cleanup Edge Function の日次スケジュール登録
-- T-60: UTC 17:00 (JST 02:00) に毎日実行
-- docs/production-runbook.md §10.2 (Cron スケジュール設定) canonical
--
-- 前提:
--   - pg_cron 拡張 (Supabase Pro plan でデフォルト有効)
--   - pg_net 拡張 (Supabase で net.http_post が使用可能)
--   - SUPABASE_URL が app.settings.supabase_url に設定済み
--   - retention-cleanup Edge Function がデプロイ済み
--
-- スケジュール変更方法:
--   cron.alter_job() または cron.unschedule() + cron.schedule() で再登録
--
-- 手動実行 (本番確認用):
--   SELECT net.http_post(
--     url := current_setting('app.settings.supabase_url') || '/functions/v1/retention-cleanup',
--     headers := '{"Authorization": "Bearer <service_role_key>"}'::jsonb,
--     body := '{}'::jsonb
--   );
-- =============================================================================

-- pg_cron / pg_net 拡張を有効化 (Supabase では事前に有効化済みが通常だが念のため)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- =============================================================================
-- cron job 登録
-- ジョブ名: 'retention-cleanup'
-- スケジュール: 毎日 UTC 17:00 (= JST 02:00)
-- 実行: net.http_post で retention-cleanup Edge Function を呼び出す
-- =============================================================================

-- 既存の同名 job があれば一旦削除してから再登録
-- (idempotent migration のため)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'retention-cleanup'
  ) THEN
    PERFORM cron.unschedule('retention-cleanup');
    RAISE NOTICE 'Unscheduled existing retention-cleanup cron job.';
  END IF;
END;
$$;

-- pg_net を使って Edge Function を HTTP POST で呼び出す cron job を登録
-- SUPABASE_URL は Supabase ダッシュボード → Project Settings → API → Project URL
-- Authorization ヘッダーの service_role key は app.settings.service_role_key に設定する。
-- (Supabase Vault または supabase/config.toml [functions.retention-cleanup] で管理)
--
-- 本番環境セットアップ手順 (docs/production-runbook.md §10.2):
--   1. Supabase Dashboard → Database → Extensions → pg_cron / pg_net を確認
--   2. Database → Settings → Config で以下を設定:
--        app.settings.supabase_url = 'https://<project-ref>.supabase.co'
--        app.settings.retention_cron_secret = '<service_role_key_or_dedicated_cron_secret>'
--   3. この migration を apply する
SELECT cron.schedule(
  'retention-cleanup',       -- job name (ユニーク)
  '0 17 * * *',              -- 毎日 UTC 17:00 = JST 02:00
  $$
    SELECT net.http_post(
      url     := current_setting('app.settings.supabase_url') || '/functions/v1/retention-cleanup',
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || current_setting('app.settings.retention_cron_secret')
                 ),
      body    := '{}'::jsonb
    );
  $$
);

-- 登録確認用クエリ (apply 後に手動で実行して確認)
-- SELECT jobid, jobname, schedule, command, active
-- FROM   cron.job
-- WHERE  jobname = 'retention-cleanup';
