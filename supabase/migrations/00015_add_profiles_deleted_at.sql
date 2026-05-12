-- Migration 00015: profiles テーブルに deleted_at カラムを追加
-- docs/account-deletion.md §猶予期間 / Sprint 4 T-2.12

ALTER TABLE trancall_auth.profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- deleted_at が設定されたレコードを高速検索するためのインデックス
CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at
  ON trancall_auth.profiles (deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN trancall_auth.profiles.deleted_at IS
  '退会リクエスト日時。NULL = アクティブ。30日後に physical deletion バッチが実行される。';
