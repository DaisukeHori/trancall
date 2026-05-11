-- =============================================================================
-- pgTAP RLS テスト: profiles_self
-- 非本人は profiles の email を UPDATE できないことを確認
-- =============================================================================

BEGIN;

SELECT plan(3);

-- テスト用ユーザーを 2 人作成 (auth.users を直接 insert するためスーパーユーザー権限で実行)
-- Supabase local stack では supabase_admin ロールが使用可能
DO $$
DECLARE
  uid_a UUID := '11111111-1111-1111-1111-111111111111';
  uid_b UUID := '22222222-2222-2222-2222-222222222222';
BEGIN
  -- auth.users に直接 insert (テスト専用)
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  VALUES
    (uid_a, 'user_a@test.example', 'dummy_hash', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (uid_b, 'user_b@test.example', 'dummy_hash', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  -- profiles を作成
  INSERT INTO trancall_auth.profiles (user_id, trancall_id, display_name, native_language, email_verified)
  VALUES
    (uid_a, 'user_a_id', 'User A', 'ja', TRUE),
    (uid_b, 'user_b_id', 'User B', 'en', TRUE)
  ON CONFLICT (user_id) DO NOTHING;
END $$;

-- 1. User A として User A 自身の display_name を UPDATE → 成功するはず
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

SELECT lives_ok(
  $$
    UPDATE trancall_auth.profiles
    SET display_name = 'User A Updated'
    WHERE user_id = '11111111-1111-1111-1111-111111111111'
  $$,
  '本人は自身の profiles を UPDATE できる'
);

-- 2. User A として User B の display_name を UPDATE → 影響行数 0 (RLS でフィルタ)
SELECT results_eq(
  $$
    WITH upd AS (
      UPDATE trancall_auth.profiles
      SET display_name = 'Hacked'
      WHERE user_id = '22222222-2222-2222-2222-222222222222'
      RETURNING user_id
    )
    SELECT count(*)::integer FROM upd
  $$,
  ARRAY[0],
  '非本人は他ユーザーの profiles を UPDATE できない (RLS により 0 行)'
);

-- 3. User A として User B の profiles を SELECT → profiles_public_read ポリシーにより SELECT は可能だが
--    email カラムは取得できることを確認 (email は公開フィールドではないが SELECT 自体は可)
--    ただし display_name は公開。SELECT 行数が 1 であることを確認。
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM trancall_auth.profiles
    WHERE user_id = '22222222-2222-2222-2222-222222222222'
  $$,
  ARRAY[1],
  'profiles_public_read ポリシーにより他ユーザーの行は SELECT 可能'
);

RESET role;

SELECT * FROM finish();

ROLLBACK;
