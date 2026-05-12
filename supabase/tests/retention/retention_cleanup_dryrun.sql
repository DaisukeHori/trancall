-- =============================================================================
-- pgTAP テスト: retention_cleanup dry-run
-- T-60: 各削除クエリが正しい行のみを対象にしているかを count で確認する。
-- 実際の DELETE は行わず SELECT count(*) で dry-run する。
--
-- 実行方法 (Supabase local stack):
--   supabase test db
--
-- 前提:
--   - 00011_add_retention_audit_table.sql が apply 済み
-- =============================================================================

BEGIN;

SELECT plan(14);

-- =============================================================================
-- テスト用データセットアップ
-- =============================================================================

DO $$
DECLARE
  uid_a UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  uid_b UUID := 'aaaaaaaa-0000-0000-0000-000000000002';
  room_id_1 UUID := 'bbbbbbbb-0000-0000-0000-000000000001';
BEGIN
  -- auth.users にテスト用ユーザー追加
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data, aud, role)
  VALUES
    (uid_a, 'retention_a@test.example', 'dummy', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (uid_b, 'retention_b@test.example', 'dummy', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  -- profiles (退会済みユーザー: deleted_at を 31 日前に設定)
  INSERT INTO trancall_auth.profiles (user_id, trancall_id, display_name, native_language, email_verified, deleted_at)
  VALUES
    (uid_a, 'ret_user_a', 'Ret User A', 'ja', TRUE, now() - INTERVAL '31 days'),
    (uid_b, 'ret_user_b', 'Ret User B', 'en', TRUE, NULL)  -- 現役ユーザー
  ON CONFLICT (user_id) DO NOTHING;

  -- rooms (uid_b で作成)
  INSERT INTO trancall_room.rooms (room_id, status, translation_enabled, created_by)
  VALUES (room_id_1, 'ended', TRUE, uid_b)
  ON CONFLICT (room_id) DO NOTHING;

  -- -----------------------------------------------------------------------
  -- trancall_transcript.segments テストデータ
  -- -----------------------------------------------------------------------
  -- 期限切れ (3 行): retention_until が過去
  INSERT INTO trancall_transcript.segments
    (room_id, participant_id, speaker_name, original_text, translated_text,
     language_pair, start_time_ms, end_time_ms, sequence_no, source_event_id, retention_until)
  VALUES
    (room_id_1, gen_random_uuid(), 'Speaker', 'Hello', 'こんにちは', 'en-ja', 0, 1000, 1, gen_random_uuid(), now() - INTERVAL '1 day'),
    (room_id_1, gen_random_uuid(), 'Speaker', 'World', '世界',     'en-ja', 1000, 2000, 2, gen_random_uuid(), now() - INTERVAL '7 days'),
    (room_id_1, gen_random_uuid(), 'Speaker', 'Test',  'テスト',  'en-ja', 2000, 3000, 3, gen_random_uuid(), now() - INTERVAL '91 days');
  -- 期限内 (1 行): retention_until が未来
  INSERT INTO trancall_transcript.segments
    (room_id, participant_id, speaker_name, original_text, translated_text,
     language_pair, start_time_ms, end_time_ms, sequence_no, source_event_id, retention_until)
  VALUES
    (room_id_1, gen_random_uuid(), 'Speaker', 'Future', '未来', 'en-ja', 3000, 4000, 4, gen_random_uuid(), now() + INTERVAL '30 days');

  -- -----------------------------------------------------------------------
  -- trancall_transcript.transcript_access テストデータ
  -- -----------------------------------------------------------------------
  -- grace period 経過済み (2 行): deleted_at が 30 日以上前
  INSERT INTO trancall_transcript.transcript_access (room_id, user_id, consent_version, deleted_at)
  VALUES
    (room_id_1, uid_a, '2026-05-12', now() - INTERVAL '31 days'),
    (room_id_1, uid_b, '2026-05-12', now() - INTERVAL '60 days');
  -- grace period 内 (1 行): deleted_at が 29 日前
  INSERT INTO trancall_transcript.transcript_access (room_id, user_id, consent_version, deleted_at)
  VALUES
    (room_id_1, uid_b, '2026-05-12', now() - INTERVAL '29 days');
  -- アクティブ (1 行): deleted_at = NULL
  INSERT INTO trancall_transcript.transcript_access (room_id, user_id, consent_version, deleted_at)
  VALUES
    (room_id_1, uid_b, '2026-05-12', NULL);

  -- -----------------------------------------------------------------------
  -- trancall_event.agent_metrics テストデータ
  -- -----------------------------------------------------------------------
  -- 30 日超 (2 行)
  INSERT INTO trancall_event.agent_metrics (agent_job_id, room_id, latency_ms, memory_rss_bytes, collected_at, received_at)
  VALUES
    (gen_random_uuid(), room_id_1, '{"totalEndToEnd": [100]}'::jsonb, 50000000, now() - INTERVAL '31 days', now() - INTERVAL '31 days'),
    (gen_random_uuid(), room_id_1, '{"totalEndToEnd": [120]}'::jsonb, 55000000, now() - INTERVAL '60 days', now() - INTERVAL '60 days');
  -- 30 日以内 (1 行)
  INSERT INTO trancall_event.agent_metrics (agent_job_id, room_id, latency_ms, memory_rss_bytes, collected_at, received_at)
  VALUES
    (gen_random_uuid(), room_id_1, '{"totalEndToEnd": [90]}'::jsonb,  48000000, now() - INTERVAL '1 day',  now() - INTERVAL '1 day');

  -- -----------------------------------------------------------------------
  -- trancall_billing.external_purchase_tokens テストデータ
  -- -----------------------------------------------------------------------
  -- expires_at + 7d 経過済み (2 行): expires_at が 8 日前以上前
  INSERT INTO trancall_billing.external_purchase_tokens
    (user_id, token, target_tier, stripe_session_id, expires_at)
  VALUES
    (uid_b, 'tok_old_1', 'standard', 'cs_old_1', now() - INTERVAL '8 days'),
    (uid_b, 'tok_old_2', 'business', 'cs_old_2', now() - INTERVAL '14 days');
  -- expires_at + 7d 未満 (1 行): expires_at が 6 日前 (7d バッファ内)
  INSERT INTO trancall_billing.external_purchase_tokens
    (user_id, token, target_tier, stripe_session_id, expires_at)
  VALUES
    (uid_b, 'tok_new_1', 'light', 'cs_new_1', now() - INTERVAL '6 days');

  -- -----------------------------------------------------------------------
  -- trancall_billing.webhook_events テストデータ
  -- -----------------------------------------------------------------------
  -- 30 日超 (2 行)
  INSERT INTO trancall_billing.webhook_events
    (provider, external_event_id, event_type, payload, processed_at, received_at)
  VALUES
    ('stripe', 'evt_old_1', 'invoice.paid', '{"id":"evt_old_1"}'::jsonb, now() - INTERVAL '31 days', now() - INTERVAL '31 days'),
    ('apple_iap', 'notif_old_1', 'DID_RENEW', '{"id":"notif_old_1"}'::jsonb, now() - INTERVAL '45 days', now() - INTERVAL '45 days');
  -- 30 日以内 (1 行)
  INSERT INTO trancall_billing.webhook_events
    (provider, external_event_id, event_type, payload, received_at)
  VALUES
    ('stripe', 'evt_new_1', 'invoice.paid', '{"id":"evt_new_1"}'::jsonb, now() - INTERVAL '1 day');

  -- -----------------------------------------------------------------------
  -- trancall_billing.usage_reservations テストデータ
  -- -----------------------------------------------------------------------
  -- completed + 7 日超 (2 行)
  INSERT INTO trancall_billing.usage_reservations
    (user_id, session_id, reserved_minutes, status, reconciled_at)
  VALUES
    (uid_b, gen_random_uuid(), 30, 'reconciled', now() - INTERVAL '8 days'),
    (uid_b, gen_random_uuid(), 60, 'expired',    now() - INTERVAL '30 days');
  -- completed だが 7 日未満 (1 行)
  INSERT INTO trancall_billing.usage_reservations
    (user_id, session_id, reserved_minutes, status, reconciled_at)
  VALUES
    (uid_b, gen_random_uuid(), 15, 'reconciled', now() - INTERVAL '6 days');
  -- active (削除対象外)
  INSERT INTO trancall_billing.usage_reservations
    (user_id, session_id, reserved_minutes, status)
  VALUES
    (uid_b, gen_random_uuid(), 20, 'active');
END $$;

-- =============================================================================
-- Dry-run テスト: 削除対象件数を count で確認 (DELETE は行わない)
-- =============================================================================

-- 1. segments: retention_until < now() → 期限切れ 3 行が対象
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM   trancall_transcript.segments
    WHERE  retention_until < now()
  $$,
  ARRAY[3],
  '1-a: 期限切れ segments は 3 行'
);

-- 2. segments: 期限内 (削除対象外) → 1 行が保持
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM   trancall_transcript.segments
    WHERE  retention_until >= now()
  $$,
  ARRAY[1],
  '1-b: 期限内 segments は 1 行 (保持対象)'
);

-- 3. transcript_access: grace period 経過済み → 2 行が対象
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM   trancall_transcript.transcript_access
    WHERE  deleted_at IS NOT NULL
      AND  deleted_at < now() - INTERVAL '30 days'
  $$,
  ARRAY[2],
  '2-a: grace period 経過済み transcript_access は 2 行'
);

-- 4. transcript_access: アクティブ行 (deleted_at IS NULL) は対象外
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM   trancall_transcript.transcript_access
    WHERE  deleted_at IS NULL
  $$,
  ARRAY[1],
  '2-b: アクティブ transcript_access は 1 行 (保持対象)'
);

-- 5. transcript_access: grace period 内 (29 日) は対象外
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM   trancall_transcript.transcript_access
    WHERE  deleted_at IS NOT NULL
      AND  deleted_at >= now() - INTERVAL '30 days'
  $$,
  ARRAY[1],
  '2-c: grace period 内の transcript_access は 1 行 (保持対象)'
);

-- 6. agent_metrics: 30 日超 → 2 行が対象
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM   trancall_event.agent_metrics
    WHERE  collected_at < now() - INTERVAL '30 days'
  $$,
  ARRAY[2],
  '3-a: 30 日超 agent_metrics は 2 行'
);

-- 7. agent_metrics: 30 日以内 → 1 行が保持
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM   trancall_event.agent_metrics
    WHERE  collected_at >= now() - INTERVAL '30 days'
  $$,
  ARRAY[1],
  '3-b: 30 日以内 agent_metrics は 1 行 (保持対象)'
);

-- 8. external_purchase_tokens: expires_at + 7d 経過済み → 2 行が対象
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM   trancall_billing.external_purchase_tokens
    WHERE  expires_at < now() - INTERVAL '7 days'
  $$,
  ARRAY[2],
  '4-a: expires_at + 7d 経過済み external_purchase_tokens は 2 行'
);

-- 9. external_purchase_tokens: 7d バッファ内 → 1 行が保持
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM   trancall_billing.external_purchase_tokens
    WHERE  expires_at >= now() - INTERVAL '7 days'
  $$,
  ARRAY[1],
  '4-b: 7d バッファ内 external_purchase_tokens は 1 行 (保持対象)'
);

-- 10. webhook_events: 30 日超 → 2 行が対象
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM   trancall_billing.webhook_events
    WHERE  received_at < now() - INTERVAL '30 days'
  $$,
  ARRAY[2],
  '5-a: 30 日超 webhook_events は 2 行'
);

-- 11. webhook_events: 30 日以内 → 1 行が保持
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM   trancall_billing.webhook_events
    WHERE  received_at >= now() - INTERVAL '30 days'
  $$,
  ARRAY[1],
  '5-b: 30 日以内 webhook_events は 1 行 (保持対象)'
);

-- 12. usage_reservations: completed + 7 日超 → 2 行が対象
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM   trancall_billing.usage_reservations
    WHERE  status IN ('reconciled', 'expired')
      AND  reconciled_at < now() - INTERVAL '7 days'
  $$,
  ARRAY[2],
  '6-a: completed + 7d 超 usage_reservations は 2 行'
);

-- 13. usage_reservations: active は削除対象外
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM   trancall_billing.usage_reservations
    WHERE  status = 'active'
  $$,
  ARRAY[1],
  '6-b: active usage_reservations は 1 行 (保持対象)'
);

-- 14. retention_runs テーブルが存在し INSERT 可能なことを確認
SELECT lives_ok(
  $$
    INSERT INTO trancall_audit.retention_runs (run_id, started_at, ended_at, deletion_counts, errors)
    VALUES (
      'cccccccc-0000-0000-0000-000000000001',
      now() - INTERVAL '5 seconds',
      now(),
      '{"segments": 3, "transcript_access": 2}'::jsonb,
      NULL
    )
  $$,
  '7: retention_runs テーブルへの INSERT が成功する'
);

SELECT * FROM finish();

ROLLBACK;
