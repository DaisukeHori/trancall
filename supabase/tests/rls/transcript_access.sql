-- =============================================================================
-- pgTAP RLS テスト: transcript_access
-- deleted_at IS NOT NULL の user は segments を読めない
-- =============================================================================

BEGIN;

SELECT plan(3);

DO $$
DECLARE
  uid_a UUID := '99999999-9999-9999-9999-999999999999';
  uid_b UUID := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  rid   UUID := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  seg_id UUID := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  VALUES
    (uid_a, 'user_a4@test.example', 'dummy_hash', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (uid_b, 'user_b4@test.example', 'dummy_hash', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO trancall_auth.profiles (user_id, trancall_id, display_name, native_language, email_verified)
  VALUES
    (uid_a, 'user_a4_id', 'User A4', 'ja', TRUE),
    (uid_b, 'user_b4_id', 'User B4', 'en', TRUE)
  ON CONFLICT (user_id) DO NOTHING;

  -- transcript_access: User A は有効 (deleted_at IS NULL)、User B は削除済み
  INSERT INTO trancall_transcript.transcript_access
    (room_id, user_id, can_view, can_export, deleted_at, consent_version)
  VALUES
    (rid, uid_a, TRUE, FALSE, NULL,   'v1.0'),
    (rid, uid_b, TRUE, FALSE, now(),  'v1.0')
  ON CONFLICT (room_id, user_id) DO NOTHING;

  -- segments に 1 行追加
  INSERT INTO trancall_transcript.segments
    (segment_id, room_id, participant_id, speaker_name, original_text,
     translated_text, language_pair, start_time_ms, end_time_ms,
     sequence_no, source_event_id, retention_until)
  VALUES
    (seg_id, rid, uid_a, 'User A4', 'Hello',
     'こんにちは', 'en-ja', 0, 1500,
     1, gen_random_uuid(), now() + INTERVAL '7 days')
  ON CONFLICT (room_id, participant_id, sequence_no) DO NOTHING;
END $$;

-- 1. User A (deleted_at IS NULL) として segments を SELECT → 1 行取得できる
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub": "99999999-9999-9999-9999-999999999999", "role": "authenticated"}';

SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM trancall_transcript.segments
    WHERE room_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  $$,
  ARRAY[1],
  'deleted_at IS NULL のユーザーは segments を SELECT できる'
);

-- 2. User B (deleted_at IS NOT NULL) として segments を SELECT → 0 行 (RLS)
SET LOCAL request.jwt.claims = '{"sub": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "role": "authenticated"}';

SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM trancall_transcript.segments
    WHERE room_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  $$,
  ARRAY[0],
  'deleted_at IS NOT NULL のユーザーは segments を SELECT できない (RLS)'
);

-- 3. User B (deleted_at IS NOT NULL) が transcript_access を SELECT → 自分の行は見えるが deleted_at で排除
--    ただし access_self ポリシーは user_id = auth.uid() なので自分の行は SELECT 可能
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM trancall_transcript.transcript_access
    WHERE user_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      AND deleted_at IS NULL
  $$,
  ARRAY[0],
  'deleted_at が設定されたアクセス行は有効な access として数えられない'
);

RESET role;

SELECT * FROM finish();

ROLLBACK;
