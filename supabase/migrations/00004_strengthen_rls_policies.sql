-- =============================================================================
-- 00004: RLS 補強
-- docs/security-detail.md の設計に基づく既存ポリシーの厳格化
-- =============================================================================

-- ---------------------------------------------------------------------------
-- contacts: contact_user_id 側からの SELECT をブロック
-- 既存 contacts_self は user_id = auth.uid() のみ許可しているが、
-- contact_user_id 側（連絡先に登録された側）が自分を誰が登録したか確認できる
-- ようにはしない。既存ポリシーはすでに user_id のみなので追加ポリシー不要だが、
-- 明示的に contact_user_id 経由でのアクセスをブロックするポリシーを補足する。
-- ---------------------------------------------------------------------------

-- contacts_self ポリシーを削除し、より厳密な定義に再作成する
DROP POLICY IF EXISTS contacts_self ON trancall_contact.contacts;

-- contacts: 自分が登録した連絡先のみ全操作可 (contact_user_id 側はアクセス不可)
CREATE POLICY contacts_owner_only ON trancall_contact.contacts
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- block_list: blockee (blocked_user_id) 側は自分がブロックされているか見えない
-- 既存 block_self は user_id = auth.uid() のみ。
-- ブロックした側 (user_id) のみがアクセスできることを明示的に再定義。
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS block_self ON trancall_contact.block_list;

-- block_list: ブロックした側のユーザーのみ参照・操作可
CREATE POLICY block_list_blocker_only ON trancall_contact.block_list
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- report_events: RLS を有効化し INSERT のみ許可（SELECT は service_role のみ）
-- report_events は 00001 で RLS が有効化されていない。ここで有効化する。
-- ---------------------------------------------------------------------------

ALTER TABLE trancall_contact.report_events ENABLE ROW LEVEL SECURITY;

-- 通報者本人による INSERT のみ許可
CREATE POLICY report_events_insert_only ON trancall_contact.report_events
  FOR INSERT
  WITH CHECK (reporter_id = auth.uid());

-- SELECT / UPDATE / DELETE は service_role のみ（RLS デフォルトで拒否）
-- service_role は RLS を bypass するため追加ポリシー不要

-- ---------------------------------------------------------------------------
-- webhook_events: 既存の USING (FALSE) ポリシーにコメントを追加するため再作成
-- service_role は RLS bypass なので書き込み・読み取りともに問題なし
-- ---------------------------------------------------------------------------

-- 既存ポリシーはそのまま維持（USING FALSE = 通常ユーザーは全操作不可）
-- service_role が RLS を bypass してアクセスする
-- コメント用の DO ブロック（実行はサーバー側 SECURITY DEFINER 関数経由）
DO $$
BEGIN
  -- webhook_events_service_only: 通常ユーザーは SELECT/INSERT/UPDATE/DELETE 全て拒否
  -- Stripe / Apple / Google Webhook ハンドラは service_role キーで接続する
  -- したがって追加ポリシーは不要
  NULL;
END $$;
