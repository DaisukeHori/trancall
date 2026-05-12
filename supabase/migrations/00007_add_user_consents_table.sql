-- =============================================================================
-- 00007: trancall_auth.user_consents テーブルを新規作成
-- =============================================================================
--
-- 背景:
--   Sprint 2 D7 (docs/legal-and-consent.md §3.4) で定義された canonical スキーマ。
--   AuthFacade.recordConsent / hasConsent / revokeConsent が使用する
--   ユーザー個別の同意記録テーブルを追加する。
--
-- 設計:
--   - UNIQUE(user_id, scope, version) で冪等な recordConsent を保証
--   - 書き込みは service_role 経由のみ (ConsentRepository.upsert で実行)
--   - ユーザーは SELECT のみ許可 (RLS: user_consents_self_read)
--   - revoked_at に SET で論理取り消しを表現 (DELETE はしない)
--   - ip_address / user_agent は監査証跡 (Phase 2 で暗号化対応予定)
--
-- 参照:
--   - docs/legal-and-consent.md v1.1 §3.4
--   - docs/module-contracts.md v1.3.0 §2.1 (AuthFacade / ConsentRepository)
-- =============================================================================

CREATE TABLE trancall_auth.user_consents (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES trancall_auth.profiles(user_id),
                -- ON DELETE NO ACTION (default): 退会時の同意記録は法定保持期間まで保持 (account-deletion.md / GDPR要件)。
                -- 退会フロー側で意図的に anonymize/delete を制御する。
  scope       VARCHAR(30) NOT NULL
                CHECK (scope IN (
                  'legal_terms', 'privacy_policy', 'voice_to_openai',
                  'transcript_retention', 'data_deletion_request',
                  'push_notification', 'marketing_email'
                )),
  version     VARCHAR(20) NOT NULL,  -- YYYY-MM-DD 形式 (例: 2026-01-01)
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,           -- NULL = 有効、非 NULL = 取り消し済み
  ip_address  TEXT,                  -- 監査証跡 (Phase 2 で暗号化推奨)
  user_agent  TEXT,
  source      VARCHAR(40) NOT NULL
                CHECK (source IN (
                  'onboarding', 'incoming_call_first_time',
                  'settings_screen', 'terms_revision_prompt'
                )),
  UNIQUE (user_id, scope, version)   -- 同一バージョンへの重複同意防止 / recordConsent 冪等性を保証
);

-- 最新同意取得用インデックス (hasConsent, getRequiredConsents で使用)
CREATE INDEX idx_user_consents_user_scope
  ON trancall_auth.user_consents(user_id, scope, recorded_at DESC);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE trancall_auth.user_consents ENABLE ROW LEVEL SECURITY;

-- ユーザーは自分の同意記録のみ読める
-- 書き込み (INSERT / UPDATE) は service_role 経由 (ConsentRepository.upsert) のみ
CREATE POLICY user_consents_self_read ON trancall_auth.user_consents
  FOR SELECT USING (user_id = auth.uid());
