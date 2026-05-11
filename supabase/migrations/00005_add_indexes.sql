-- =============================================================================
-- 00005: performance 補強 index 追加
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. usage_windows: 当期サイクル検索高速化
-- billing-detail.md の reserveMinutes SQL は current_period_start/end を
-- WHERE 条件で使うため、user_id + recorded_at の index が必要。
-- ※ 当初 WHERE recorded_at > now() - INTERVAL '60 days' の partial index を
--    検討したが、now() は VOLATILE 関数であるため PostgreSQL の
--    "functions in index predicate must be marked IMMUTABLE" エラーが発生する。
--    00001_initial_schema.sql の idx_usage_windows_user
--    (user_id, recorded_at DESC) で代替済みのため、ここでは作成しない。
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 2. participants: 通話履歴ソート用
-- GET /api/rooms/history の履歴表示で joined_at DESC ソートを高速化。
-- ---------------------------------------------------------------------------
CREATE INDEX idx_participants_user_joined
  ON trancall_room.participants(user_id, joined_at DESC);

-- ---------------------------------------------------------------------------
-- 3. device_tokens: アクティブトークン検索高速化
-- Push 通知送信時に is_active = TRUE のトークンのみ検索するため。
-- ---------------------------------------------------------------------------
CREATE INDEX idx_device_tokens_user_active
  ON trancall_notification.device_tokens(user_id, platform, is_active)
  WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- 4. transcript_access: 有効な access レコード検索高速化
-- segments の RLS ポリシーで transcript_access を JOIN する際、
-- deleted_at IS NULL 条件を partial index で最適化。
-- ---------------------------------------------------------------------------
CREATE INDEX idx_transcript_access_active
  ON trancall_transcript.transcript_access(room_id, user_id)
  WHERE deleted_at IS NULL;
