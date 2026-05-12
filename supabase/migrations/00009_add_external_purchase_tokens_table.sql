-- =============================================================================
-- 00009: external_purchase_tokens テーブル追加
-- docs/billing-ui-flow.md v1.2 §15.3 canonical DDL 準拠
-- StoreKit External Purchase の redirectToken を管理するテーブル。
-- TTL 5 分・1 回限り使い捨て制約を DB レベルで保証する。
-- =============================================================================

CREATE TABLE trancall_billing.external_purchase_tokens (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES trancall_auth.profiles(user_id),
  token          VARCHAR     NOT NULL UNIQUE,
  target_tier    VARCHAR     NOT NULL,
  stripe_session_id VARCHAR  NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  used           BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- token 検索用インデックス (completeExternalPurchase で token 引き当て)
CREATE INDEX ON trancall_billing.external_purchase_tokens (token);

-- 未使用トークンの期限切れスキャン用インデックス (クリーンアップジョブ用)
CREATE INDEX ON trancall_billing.external_purchase_tokens (expires_at) WHERE used = false;

-- user_id / status 検索用インデックス (ユーザー別の有効トークン確認)
CREATE INDEX ON trancall_billing.external_purchase_tokens (user_id, used);

-- ---------------------------------------------------------------------------
-- RLS: architecture.md §6.3「全テーブルに RLS を適用」方針に従う
-- ---------------------------------------------------------------------------
ALTER TABLE trancall_billing.external_purchase_tokens ENABLE ROW LEVEL SECURITY;

-- ユーザー自身の token のみ SELECT 可 (service_role は RLS bypass、anon は参照不可)
CREATE POLICY external_purchase_tokens_self_select
  ON trancall_billing.external_purchase_tokens
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- INSERT / UPDATE / DELETE は server (service_role) 経由のみ。
-- authenticated ユーザーによる書き込みを拒否する。
CREATE POLICY external_purchase_tokens_no_write
  ON trancall_billing.external_purchase_tokens
  FOR ALL TO authenticated
  USING (false);
