-- =============================================================================
-- pgTAP RLS テスト: contacts_self
-- 他人の contacts を SELECT できないこと、contact_user_id 側もアクセス不可
-- =============================================================================

BEGIN;

SELECT plan(3);

DO $$
DECLARE
  uid_a UUID := '66666666-6666-6666-6666-666666666666';
  uid_b UUID := '77777777-7777-7777-7777-777777777777';
  uid_c UUID := '88888888-8888-8888-8888-888888888888';
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  VALUES
    (uid_a, 'user_a3@test.example', 'dummy_hash', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (uid_b, 'user_b3@test.example', 'dummy_hash', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (uid_c, 'user_c3@test.example', 'dummy_hash', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO trancall_auth.profiles (user_id, trancall_id, display_name, native_language, email_verified)
  VALUES
    (uid_a, 'user_a3_id', 'User A3', 'ja', TRUE),
    (uid_b, 'user_b3_id', 'User B3', 'en', TRUE),
    (uid_c, 'user_c3_id', 'User C3', 'ko', TRUE)
  ON CONFLICT (user_id) DO NOTHING;

  -- User A が User B を連絡先に追加
  INSERT INTO trancall_contact.contacts (user_id, contact_user_id)
  VALUES (uid_a, uid_b)
  ON CONFLICT (user_id, contact_user_id) DO NOTHING;
END $$;

-- 1. User A (contacts オーナー) として SELECT → 1 行取得できる
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM trancall_contact.contacts
    WHERE user_id = '66666666-6666-6666-6666-666666666666'
  $$,
  ARRAY[1],
  'contacts オーナー (user_id) は自身の連絡先を SELECT できる'
);

-- 2. User B (contact_user_id 側) として User A の contacts を SELECT → 0 行 (RLS)
SET LOCAL request.jwt.claims = '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';

SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM trancall_contact.contacts
    WHERE user_id = '66666666-6666-6666-6666-666666666666'
  $$,
  ARRAY[0],
  'contact_user_id 側のユーザーは他人の contacts を SELECT できない'
);

-- 3. User C (無関係なユーザー) として User A の contacts を SELECT → 0 行 (RLS)
SET LOCAL request.jwt.claims = '{"sub": "88888888-8888-8888-8888-888888888888", "role": "authenticated"}';

SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM trancall_contact.contacts
  $$,
  ARRAY[0],
  '無関係なユーザーは contacts テーブル全体で 0 行しか見えない'
);

RESET role;

SELECT * FROM finish();

ROLLBACK;
