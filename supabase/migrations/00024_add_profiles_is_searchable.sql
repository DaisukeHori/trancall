-- =============================================================================
-- 00024: trancall_auth.profiles.is_searchable 追加 (Issue #64)
-- 表示名の部分一致検索 (searchByDisplayName) を opt-in 化する。
-- =============================================================================
--
-- 背景:
--   apps/server/src/adapters/repositories/contact/profile-search-repository.supabase.ts
--   のコメント (#26) の通り、現行スキーマには「検索対象に含めるか」を明示する
--   ユーザー opt-in フラグが存在せず、全ユーザーがデフォルトで表示名検索の対象に
--   含まれていた。これはプライバシー上望ましくない (本人の意図に関わらず、
--   表示名の部分一致だけで他ユーザーから発見されてしまう)。
--
-- 対応:
--   trancall_auth.profiles に is_searchable boolean を追加する。
--   デフォルトは false (= 検索対象外)。既存ユーザーは全員このデフォルトが
--   適用されるため、本 migration 適用直後は「全員が非検索対象」という
--   破壊的でない安全側の状態になる (= 検索結果が減る方向の変更であり、
--   意図しない情報露出が増える方向の変更ではない)。
--
--   `trancall_auth.public_profiles` VIEW (migration 00017) に is_searchable を
--   公開列として追加する。VIEW 自体の WHERE 句には is_searchable を含めない
--   (ProfileSearchRepository.findByTrancallId — 完全一致の ID 検索は既存の
--   ProfileSearchRepository インターフェース JSDoc の通り opt-in の対象外とする。
--   TranCall ID を明示的に知っているユーザーからの追加は、招待リンクや
--   ID 共有と同様の「知っている人だけが辿り着ける」導線であり、
--   discoverability (表示名検索によるユーザー列挙) とは性質が異なるため)。
--   searchByDisplayName 側のクエリで is_searchable = true の WHERE 条件を
--   アプリケーションコード側 (profile-search-repository.supabase.ts) に追加する。
--
-- 影響確認:
--   apps/server は service_role で Supabase クライアントを生成しており RLS を
--   bypass するため、本 migration は既存の RLS ポリシーに影響しない。
--   public_profiles VIEW を DROP + CREATE で再作成するため、00017 で行った
--   GRANT SELECT ON public_profiles TO authenticated を再度実行する
--   (VIEW の DROP は既存の GRANT を失効させるため)。
-- =============================================================================

ALTER TABLE trancall_auth.profiles
  ADD COLUMN is_searchable BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN trancall_auth.profiles.is_searchable IS
  '表示名の部分一致検索 (ProfileSearchRepository.searchByDisplayName) の対象に含めるか '
  '(Issue #64)。デフォルト false = 非検索対象 (プライバシー保護のための安全側デフォルト)。'
  'TranCall ID 完全一致検索 (findByTrancallId) はこのフラグの対象外。';

-- ---------------------------------------------------------------------------
-- public_profiles VIEW を再作成し is_searchable を公開列に追加
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS trancall_auth.public_profiles;

CREATE VIEW trancall_auth.public_profiles
WITH (security_invoker = false) AS
SELECT
  user_id,
  trancall_id,
  display_name,
  native_language,
  avatar_url,
  is_searchable
FROM trancall_auth.profiles
WHERE deleted_at IS NULL;

COMMENT ON VIEW trancall_auth.public_profiles IS
  '他ユーザーが参照して良い最小限のプロフィール情報のみを公開する VIEW (Issue #26)。'
  'email_verified / consent_version / deleted_at / created_at / updated_at は含めない。'
  'deleted_at IS NULL の行のみ (退会申請済みユーザーは非公開)。'
  'is_searchable (Issue #64) は表示名検索の opt-in フラグとして公開し、'
  'searchByDisplayName のクエリ側で WHERE is_searchable = true を適用する。'
  'security_invoker=false のため VIEW 所有者権限で base table を参照し、'
  'base table 側の profiles_self (本人限定) ポリシーに関わらず他ユーザーの最小情報を返す。';

-- DROP VIEW は既存の GRANT を失効させるため、00017 と同じ権限を再付与する
GRANT USAGE ON SCHEMA trancall_auth TO authenticated;
GRANT SELECT ON trancall_auth.public_profiles TO authenticated;
