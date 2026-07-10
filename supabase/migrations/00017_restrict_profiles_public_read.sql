-- =============================================================================
-- 00017: profiles の過度な公開 RLS ポリシーを是正
-- Issue #26: profiles_public_read FOR SELECT USING (TRUE) は TO 句が無いため
-- anon を含む全ロールに対して全カラム（email_verified / deleted_at /
-- consent_version 等の非公開情報を含む）を無制限に公開してしまっていた。
-- =============================================================================
--
-- 影響確認 (本番適用前提として実施済み):
--   apps/server は SUPABASE_SERVICE_ROLE_KEY で Supabase クライアントを生成しており
--   （apps/server/src/container.ts）、service_role は RLS を bypass するため、
--   下記の既存参照箇所は本 migration の影響を受けない:
--     - apps/server/src/adapters/repositories/contact/profile-search-repository.supabase.ts
--       (findByTrancallId / searchByDisplayName)
--     - apps/server/src/adapters/repositories/auth/profile-repository.supabase.ts
--     - apps/server/src/routes/{auth-routes,account-routes}.ts
--   apps/mobile はクライアント側から直接 trancall_auth.profiles を参照していない
--   （Supabase クエリは全て apps/server 経由）。
--   したがって RLS を絞ってもアプリの既存機能には影響しない
--   （anon/authenticated キーで直接 profiles を叩く経路が無いため）。
--
-- 対応:
--   1. profiles_public_read（TO 句なし・USING TRUE・全カラム公開）を DROP。
--      これにより base table への「本人以外」からの SELECT は不可能になる
--      （profiles_self は user_id = auth.uid() の本人アクセスのみなので維持）。
--   2. 「公開して良い最小カラムだけ」を含む trancall_auth.public_profiles VIEW を新設。
--      - 対象カラム: user_id, trancall_id, display_name, native_language, avatar_url
--        （email_verified / consent_version / deleted_at / created_at / updated_at は含めない）
--      - deleted_at IS NULL の行のみ（退会申請済み・物理削除待ちのユーザーは非表示）
--      - VIEW は所有者（migration 実行ロール）権限で base table を参照するため
--        （security_invoker を明示していない ＝ Postgres のデフォルト挙動）、
--        base table 側で profiles_self のみになっていても
--        「他人の最小公開情報」を返却できる。
--   3. trancall_auth スキーマの USAGE と public_profiles への SELECT を
--      authenticated ロールにのみ付与（anon には付与しない）。
--
-- 注意:
--   本 migration 適用前にどこかで anon/authenticated キーによる profiles 直接参照が
--   実装されていた場合は、本 migration 適用後に trancall_auth.public_profiles への
--   参照に切り替える必要がある（apps/ 配下は本タスクのスコープ外のため未変更）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. 既存の過度に広い SELECT ポリシーを削除
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_public_read ON trancall_auth.profiles;

-- profiles_self（本人は全カラム全操作可）は変更なし・維持
-- CREATE POLICY profiles_self ON trancall_auth.profiles
--   FOR ALL USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. 公開最小カラムのみを含む VIEW
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS trancall_auth.public_profiles;

CREATE VIEW trancall_auth.public_profiles
WITH (security_invoker = false) AS
SELECT
  user_id,
  trancall_id,
  display_name,
  native_language,
  avatar_url
FROM trancall_auth.profiles
WHERE deleted_at IS NULL;

COMMENT ON VIEW trancall_auth.public_profiles IS
  '他ユーザーが参照して良い最小限のプロフィール情報のみを公開する VIEW (Issue #26)。'
  'email_verified / consent_version / deleted_at / created_at / updated_at は含めない。'
  'deleted_at IS NULL の行のみ (退会申請済みユーザーは非公開)。'
  'security_invoker=false のため VIEW 所有者権限で base table を参照し、'
  'base table 側の profiles_self (本人限定) ポリシーに関わらず他ユーザーの最小情報を返す。';

-- ---------------------------------------------------------------------------
-- 3. 権限付与（authenticated のみ。anon には付与しない）
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA trancall_auth TO authenticated;
GRANT SELECT ON trancall_auth.public_profiles TO authenticated;
