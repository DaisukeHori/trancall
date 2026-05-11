-- =============================================================================
-- pgTAP RLS テスト: rooms_participant
-- 非参加者は rooms を SELECT できない、参加者は SELECT 可
-- =============================================================================

BEGIN;

SELECT plan(4);

DO $$
DECLARE
  uid_a  UUID := '33333333-3333-3333-3333-333333333333';
  uid_b  UUID := '44444444-4444-4444-4444-444444444444';
  uid_c  UUID := '55555555-5555-5555-5555-555555555555';  -- 部屋に参加していないユーザー
  rid    UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  VALUES
    (uid_a, 'user_a2@test.example', 'dummy_hash', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (uid_b, 'user_b2@test.example', 'dummy_hash', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (uid_c, 'user_c@test.example',  'dummy_hash', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO trancall_auth.profiles (user_id, trancall_id, display_name, native_language, email_verified)
  VALUES
    (uid_a, 'user_a2_id', 'User A2', 'ja', TRUE),
    (uid_b, 'user_b2_id', 'User B2', 'en', TRUE),
    (uid_c, 'user_c_id',  'User C',  'fr', TRUE)
  ON CONFLICT (user_id) DO NOTHING;

  -- Room 作成 (service_role として)
  INSERT INTO trancall_room.rooms (room_id, status, room_type, translation_enabled, created_by)
  VALUES (rid, 'active', 'audio', TRUE, uid_a)
  ON CONFLICT (room_id) DO NOTHING;

  -- User A と User B を参加者として登録
  INSERT INTO trancall_room.participants (room_id, user_id, role)
  VALUES
    (rid, uid_a, 'host'),
    (rid, uid_b, 'member')
  ON CONFLICT (room_id, user_id) DO NOTHING;
END $$;

-- 1. User A (参加者・host) として rooms を SELECT → 1 行取得できる
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM trancall_room.rooms
    WHERE room_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $$,
  ARRAY[1],
  '参加者 (host) は自分が所属する room を SELECT できる'
);

-- 2. User B (参加者・member) として rooms を SELECT → 1 行取得できる
SET LOCAL request.jwt.claims = '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM trancall_room.rooms
    WHERE room_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $$,
  ARRAY[1],
  '参加者 (member) は自分が所属する room を SELECT できる'
);

-- 3. User C (非参加者) として rooms を SELECT → 0 行 (RLS でフィルタ)
SET LOCAL request.jwt.claims = '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM trancall_room.rooms
    WHERE room_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $$,
  ARRAY[0],
  '非参加者は room を SELECT できない (RLS により 0 行)'
);

-- 4. User C (非参加者) として rooms に INSERT → 失敗する (created_by != auth.uid())
SET LOCAL request.jwt.claims = '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

SELECT throws_ok(
  $$
    INSERT INTO trancall_room.rooms (room_id, status, room_type, translation_enabled, created_by)
    VALUES (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'waiting', 'audio', FALSE,
      '33333333-3333-3333-3333-333333333333'
    )
  $$,
  '42501',
  NULL,
  '非本人 created_by での rooms INSERT は RLS で拒否される'
);

RESET role;

SELECT * FROM finish();

ROLLBACK;
