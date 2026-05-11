-- =============================================================================
-- pgTAP RLS テスト: subscriptions_self
-- 他人の subscriptions を SELECT できないことを確認
-- =============================================================================

BEGIN;

SELECT plan(3);

DO $$
DECLARE
  uid_a UUID := 'ffffffff-1111-2222-3333-444444444444';
  uid_b UUID := 'ffffffff-5555-6666-7777-888888888888';
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  VALUES
    (uid_a, 'user_a5@test.example', 'dummy_hash', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (uid_b, 'user_b5@test.example', 'dummy_hash', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO trancall_auth.profiles (user_id, trancall_id, display_name, native_language, email_verified)
  VALUES
    (uid_a, 'user_a5_id', 'User A5', 'ja', TRUE),
    (uid_b, 'user_b5_id', 'User B5', 'en', TRUE)
  ON CONFLICT (user_id) DO NOTHING;

  -- 両ユーザーの subscriptions を作成
  INSERT INTO trancall_billing.subscriptions
    (user_id, plan_tier, included_minutes, overage_rate_yen, monthly_price_yen,
     transcript_retention_days, purchase_channel)
  VALUES
    (uid_a, 'free',     5,   0,    0,    7, 'free'),
    (uid_b, 'standard', 120, 10, 2980, 90, 'free')
  ON CONFLICT (user_id) DO NOTHING;
END $$;

-- 1. User A として自身の subscriptions を SELECT → 1 行取得できる
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub": "ffffffff-1111-2222-3333-444444444444", "role": "authenticated"}';

SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM trancall_billing.subscriptions
    WHERE user_id = 'ffffffff-1111-2222-3333-444444444444'
  $$,
  ARRAY[1],
  '本人は自身の subscriptions を SELECT できる'
);

-- 2. User A として User B の subscriptions を SELECT → 0 行 (RLS)
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM trancall_billing.subscriptions
    WHERE user_id = 'ffffffff-5555-6666-7777-888888888888'
  $$,
  ARRAY[0],
  '他人の subscriptions は SELECT できない (RLS により 0 行)'
);

-- 3. User A として subscriptions 全体を SELECT → 自分の 1 行のみ
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM trancall_billing.subscriptions
  $$,
  ARRAY[1],
  'subscriptions テーブル全体を SELECT しても自分の 1 行しか見えない'
);

RESET role;

SELECT * FROM finish();

ROLLBACK;
