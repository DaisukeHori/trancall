-- =============================================================================
-- 00019: 退会30日後の物理削除が FK 違反で失敗する問題のスキーマ側修正
-- Issue #07 (#45): supabase/functions/retention-cleanup が
-- auth.admin.deleteUser() → CASCADE trancall_auth.profiles 削除を試みる際、
-- profiles(user_id) を参照する ON DELETE NO ACTION の子テーブルが残っていると
-- 必ず FK 違反で失敗する。
-- =============================================================================
--
-- 00001_initial_schema.sql の FK 定義を全洗い出しした結果:
--
--   ON DELETE CASCADE 済み（対応不要・profiles 削除で自動的に子行も削除される）:
--     - trancall_contact.contacts.user_id / contact_user_id
--     - trancall_contact.block_list.user_id / blocked_user_id
--     - trancall_notification.device_tokens.user_id
--     - trancall_contact.invite_links.user_id (作成者)
--
--   ON DELETE NO ACTION（デフォルト）で削除をブロックする列:
--     - trancall_room.rooms.created_by                  NOT NULL
--     - trancall_room.participants.user_id               NOT NULL
--     - trancall_contact.report_events.reporter_id        NOT NULL
--     - trancall_contact.report_events.reported_id        NOT NULL
--     - trancall_billing.subscriptions.user_id            NOT NULL UNIQUE
--     - trancall_billing.usage_windows.user_id             NOT NULL
--     - trancall_billing.usage_reservations.user_id        NOT NULL
--     - trancall_transcript.transcript_access.user_id      NOT NULL
--     - trancall_billing.external_purchase_tokens.user_id  NOT NULL
--     - trancall_contact.invite_links.used_by (被招待者)   NULL 許容（変更不要）
--     - trancall_auth.user_consents.user_id                NOT NULL（別途 §2 で対応）
--
-- 対応方針:
--   docs/account-deletion.md のデータ処理ポリシーに基づき、
--   rooms / participants / report_events / subscriptions / usage_windows は
--   「行としては保持するが、退会ユーザーへの識別可能な参照は外す」方針のため、
--   該当 FK 列を NULL 許容化し、retention-cleanup Edge Function 側で
--   auth.admin.deleteUser() の直前に NULL 化する
--   （trancall_transcript.transcript_access / trancall_billing.usage_reservations /
--   trancall_billing.external_purchase_tokens / invite_links.used_by は
--   「即座に削除/revoke される」設計のため、retention-cleanup 側で
--   念のため DELETE / NULL 化するフォールバック処理を追加する。列制約変更は不要）。
--
--   trancall_auth.user_consents は GDPR 法定保持要件により行を保持したまま
--   user_id を匿名 UUID へ差し替える必要があるが、匿名 UUID は
--   trancall_auth.profiles に実在しないため FK 自体が両立不能。
--   §2 で FK 制約を削除し、user_id を「実在する profiles.user_id、または
--   GDPR 匿名化 UUID（案1: 決定論的 per-user UUID）のいずれか」を許容する
--   非強制の識別子カラムとして扱う。
--
-- 影響（要確認事項として最終報告に明記）:
--   NOT NULL → NULL 許容への変更はアプリ側の型定義 (Zod スキーマ等) が
--   非 NULL を前提にしている場合、実行時のバリデーションエラーを招く可能性がある。
--   本 migration は supabase/ 配下スキーマ変更のみが対象範囲のため、
--   apps/ packages/ 側の型更新は別タスクで確認・対応すること。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- §1. NOT NULL 制約緩和（退会ユーザー purge 時に NULL 化するため）
-- ---------------------------------------------------------------------------

ALTER TABLE trancall_room.rooms
  ALTER COLUMN created_by DROP NOT NULL;

COMMENT ON COLUMN trancall_room.rooms.created_by IS
  'Room 作成者。NULL は作成者が退会し物理削除済みであることを示す (Issue #07)。';

ALTER TABLE trancall_room.participants
  ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN trancall_room.participants.user_id IS
  '参加者。NULL は当該ユーザーが退会し物理削除済みであることを示す (Issue #07)。';

ALTER TABLE trancall_contact.report_events
  ALTER COLUMN reporter_id DROP NOT NULL,
  ALTER COLUMN reported_id DROP NOT NULL;

COMMENT ON COLUMN trancall_contact.report_events.reporter_id IS
  '通報者。NULL は当該ユーザーが退会し物理削除済みであることを示す (Issue #07)。';
COMMENT ON COLUMN trancall_contact.report_events.reported_id IS
  '被通報者。NULL は当該ユーザーが退会し物理削除済みであることを示す (Issue #07)。';

ALTER TABLE trancall_billing.subscriptions
  ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN trancall_billing.subscriptions.user_id IS
  'NULL は契約者が退会し物理削除済みであることを示す (Issue #07)。'
  'UNIQUE 制約は維持（Postgres の UNIQUE は複数 NULL を許容するため矛盾しない）。';

-- usage_windows は docs/account-deletion.md で当初から
-- 「保持（匿名化、user_idをnullに）| 30日後」と定義済み。
-- NOT NULL 制約により実装不能だったため、ここで整合させる。
ALTER TABLE trancall_billing.usage_windows
  ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN trancall_billing.usage_windows.user_id IS
  'NULL は退会30日後の匿名化バッチ (retention-cleanup) 実行済みであることを示す。'
  'docs/account-deletion.md §データ処理ポリシー canonical。';

-- ---------------------------------------------------------------------------
-- §2. trancall_auth.user_consents.user_id の FK 制約を削除
-- ---------------------------------------------------------------------------
-- GDPR 法定保持要件により user_consents 行は削除せず、user_id のみを
-- 決定論的匿名 UUID (docs/account-deletion.md §TODO T-29 案1) に置換して保持する。
-- 匿名 UUID は意図的に trancall_auth.profiles に存在しない値であるため、
-- FK 制約が残っている限りこの UPDATE は必ず失敗する。
-- 参照整合性はアプリ側 (retention-cleanup Edge Function) の運用ルールで担保する:
--   - user_id は「実在する profiles.user_id」または
--     「deriveAnonymizedUserId() が生成した決定論的 UUID」のいずれか。
-- インデックス idx_user_consents_user_scope は FK 削除後も継続利用する。
ALTER TABLE trancall_auth.user_consents
  DROP CONSTRAINT IF EXISTS user_consents_user_id_fkey;

COMMENT ON COLUMN trancall_auth.user_consents.user_id IS
  '同意記録の対象ユーザー。FK 制約なし (Issue #07 で意図的に削除)。'
  '実在する trancall_auth.profiles.user_id、または退会30日後の物理削除時に '
  'retention-cleanup が生成する GDPR 匿名化 UUID (deriveAnonymizedUserId) のいずれか。'
  'docs/account-deletion.md §TODO (T-29) 案1 準拠。';
