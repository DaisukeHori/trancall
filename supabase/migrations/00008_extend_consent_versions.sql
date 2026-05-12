-- =============================================================================
-- 00008: trancall_auth.consent_versions テーブルを拡張
-- =============================================================================
--
-- 背景:
--   00001 §15 で作成した consent_versions は scope 概念がなく、
--   version を単一 PK とする簡易構造だった。
--   Sprint 2 D7 (docs/legal-and-consent.md §3.4) で scope 列追加と
--   複合 PK (version, scope) への再構成を要件として確定。
--
-- 変更内容:
--   1. scope 列追加 (NOT NULL, DEFAULT 'legal_terms')
--   2. supersedes 列追加 (旧バージョンの version を参照)
--   3. change_summary 列追加 (改訂概要テキスト)
--   4. data migration: 既存行 version='v1.0' → '2026-01-01' に統一
--      (本書の YYYY-MM-DD バージョン形式と整合)
--   5. PK 再構成: (version) 単一 → (version, scope) 複合
--   6. 全 scope の 2026-01-01 基準行を backfill (idempotent)
--   7. 現行 Sprint リリース向け '2026-05-12' 版を全 scope 分 INSERT (idempotent)
--
-- 参照:
--   - docs/legal-and-consent.md v1.1 §3.4 / §5.3
--   - docs/module-contracts.md v1.3.0 §2.1
-- =============================================================================

-- =============================================================================
-- Step 1: 列追加
-- =============================================================================

ALTER TABLE trancall_auth.consent_versions
  ADD COLUMN scope          VARCHAR(30) NOT NULL DEFAULT 'legal_terms'
    CHECK (scope IN (
      'legal_terms', 'privacy_policy', 'voice_to_openai',
      'transcript_retention', 'data_deletion_request',
      'push_notification', 'marketing_email'
    )),
  ADD COLUMN supersedes     VARCHAR(20),   -- 直前バージョンの version 値 (任意)
  ADD COLUMN change_summary TEXT;          -- 改訂概要 (任意)

-- =============================================================================
-- Step 2: data migration — 既存行の version='v1.0' を '2026-01-01' に正規化
-- =============================================================================
-- 00001 §15 の INSERT で挿入された行。本書の YYYY-MM-DD 形式に統一する。
-- effective_at はそのまま維持 (INSERT 時の now() が入っている)

UPDATE trancall_auth.consent_versions
  SET version = '2026-01-01'
  WHERE version = 'v1.0';

-- =============================================================================
-- Step 3: PK 再構成
--   (version) 単一 → (version, scope) 複合
--   同一 version で複数 scope を持てるようにする
-- =============================================================================

ALTER TABLE trancall_auth.consent_versions
  DROP CONSTRAINT consent_versions_pkey;

ALTER TABLE trancall_auth.consent_versions
  ADD PRIMARY KEY (version, scope);

-- =============================================================================
-- Step 4: 全 scope の 2026-01-01 基準行を backfill
-- =============================================================================
-- 既存の 'legal_terms' 行 (version='2026-01-01') は Step 2 で更新済みのため
-- ON CONFLICT DO NOTHING で安全に冪等実行できる。
-- voice_to_openai / transcript_retention / push_notification / marketing_email /
-- privacy_policy / data_deletion_request は新規 INSERT。
--
-- effective_at = '2026-01-01' は、TranCall サービス開始時点として backfill する。

INSERT INTO trancall_auth.consent_versions
  (version, scope, effective_at, description, policy_url, requires_reconsent, change_summary)
VALUES
  ('2026-01-01', 'legal_terms',
   '2026-01-01T00:00:00Z',
   'サービス開始版利用規約',
   'https://trancall.app/terms',
   TRUE, NULL),
  ('2026-01-01', 'privacy_policy',
   '2026-01-01T00:00:00Z',
   'サービス開始版プライバシーポリシー',
   'https://trancall.app/privacy',
   TRUE, NULL),
  ('2026-01-01', 'voice_to_openai',
   '2026-01-01T00:00:00Z',
   'OpenAI への音声送信同意 (GPT-Realtime-Translate)',
   NULL, FALSE, NULL),
  ('2026-01-01', 'transcript_retention',
   '2026-01-01T00:00:00Z',
   'トランスクリプト保持期間同意 (プラン別)',
   NULL, FALSE, NULL),
  ('2026-01-01', 'push_notification',
   '2026-01-01T00:00:00Z',
   'Push 通知許可',
   NULL, FALSE, NULL),
  ('2026-01-01', 'marketing_email',
   '2026-01-01T00:00:00Z',
   'マーケティングメール受信同意',
   NULL, FALSE, NULL),
  ('2026-01-01', 'data_deletion_request',
   '2026-01-01T00:00:00Z',
   'データ削除リクエスト同意',
   NULL, FALSE, NULL)
ON CONFLICT (version, scope) DO NOTHING;

-- =============================================================================
-- Step 5: 現行 Sprint リリース向け '2026-05-12' 版を全 scope 分 INSERT
-- =============================================================================
-- docs/legal-and-consent.md §5.3 canonical 定義に従い INSERT。
-- scope = 'data_deletion_request' / 'marketing_email' は §5.3 に記載なしのため
-- 必要最小限の行のみ追加 (追加は別途判断)。

INSERT INTO trancall_auth.consent_versions
  (version, scope, effective_at, description, policy_url, requires_reconsent, change_summary)
VALUES
  ('2026-05-12', 'legal_terms',
   '2026-05-12T00:00:00Z',
   '初版利用規約',
   'https://trancall.app/terms',
   TRUE, NULL),
  ('2026-05-12', 'privacy_policy',
   '2026-05-12T00:00:00Z',
   '初版プライバシーポリシー',
   'https://trancall.app/privacy',
   TRUE, NULL),
  ('2026-05-12', 'voice_to_openai',
   '2026-05-12T00:00:00Z',
   'OpenAI への音声送信同意 (GPT-Realtime-Translate)',
   NULL, FALSE, NULL),
  ('2026-05-12', 'transcript_retention',
   '2026-05-12T00:00:00Z',
   'トランスクリプト保持期間同意 (プラン別)',
   NULL, FALSE, NULL),
  ('2026-05-12', 'push_notification',
   '2026-05-12T00:00:00Z',
   'Push 通知許可',
   NULL, FALSE, NULL)
ON CONFLICT (version, scope) DO NOTHING;
