-- =============================================================================
-- 00021: user_consents の UNIQUE 制約を「アクティブ行のみ一意」に緩和 (Issue #34)
-- =============================================================================
--
-- 背景:
--   00007 で定義した UNIQUE (user_id, scope, version) は「同一バージョンへの重複同意
--   防止 / recordConsent の冪等性」を意図していたが、ConsentRepository.upsert
--   (apps/server/src/adapters/repositories/auth/consent-repository.supabase.ts) が
--   この制約を使った ON CONFLICT DO UPDATE を実装していたため、
--   同一 (user_id, scope, version) への再同意のたびに既存行が UPDATE され、
--   revoked_at (取消日時) が null に、recorded_at (初回同意日時) が新時刻に
--   上書きされてしまい、監査証跡 (いつ同意し、いつ取り消したか) が失われていた。
--
-- 対応:
--   UNIQUE (user_id, scope, version) を削除し、代わりに
--   「revoked_at IS NULL の行のみ (user_id, scope, version) が一意」という
--   部分一意インデックスに置き換える。
--   これにより:
--     - 取消済み (revoked_at IS NOT NULL) の行は複数保持できる (履歴として残る)
--     - 同一バージョンへの「今アクティブな」同意は依然として 1 行のみに制限される
--       (recordConsent の冪等性・二重アクティブ行の防止は維持)
--   ConsentRepository.upsert はアプリ側で「既存アクティブ行があれば返す、
--   なければ INSERT で追記する」方式に変更済み (UPDATE は一切行わない)。
--
-- 影響確認:
--   listActive / findActive は revoked_at IS NULL でフィルタしているため、
--   本 migration 後も「現在有効な同意」の取得ロジックに変更は不要。
-- =============================================================================

-- 1. 既存の UNIQUE 制約を削除 (自動生成された制約名に依存しないよう動的に検索する)
DO $$
DECLARE
  target_constraint_name text;
BEGIN
  SELECT con.conname INTO target_constraint_name
  FROM pg_constraint con
  WHERE con.conrelid = 'trancall_auth.user_consents'::regclass
    AND con.contype = 'u'
    AND con.conkey = (
      SELECT array_agg(attnum ORDER BY attnum)
      FROM pg_attribute
      WHERE attrelid = 'trancall_auth.user_consents'::regclass
        AND attname IN ('user_id', 'scope', 'version')
    );

  IF target_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE trancall_auth.user_consents DROP CONSTRAINT %I',
      target_constraint_name
    );
  END IF;
END $$;

-- 2. 「アクティブ行 (revoked_at IS NULL) のみ一意」の部分一意インデックスを追加
CREATE UNIQUE INDEX IF NOT EXISTS user_consents_active_unique
  ON trancall_auth.user_consents (user_id, scope, version)
  WHERE revoked_at IS NULL;

COMMENT ON INDEX trancall_auth.user_consents_active_unique IS
  '同一 (user_id, scope, version) につき「取消されていない (revoked_at IS NULL) 行」は '
  '常に高々 1 件であることを保証する部分一意インデックス (Issue #34)。'
  '取消済み行は対象外のため複数保持でき、取消 → 再同意の履歴を追記型で残せる。';
