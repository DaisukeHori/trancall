-- =============================================================================
-- 00020: trancall_billing.room_reservation_sessions
--
-- #46 usage metering: roomId ↔ billing 予約 sessionId (TranslationSessionId) の対応表。
--
-- billing.reserveMinutes / billing.reconcile / billing.recordUsage は
-- apps/server/src/routes/room-routes.ts が独自採番した sessionId (TranslationSessionId) を
-- キーに動作するが、translation.ended DomainEvent の payload には roomId しか含まれず、
-- billing 予約時に発行した sessionId を直接は知らない
-- (packages/translation の sessionId は Agent 側 trancall_event.translation_sessions.id で
-- 別途採番される、billing の予約 sessionId とは無関係の UUID)。
--
-- apps/server/src/routes/room-routes.ts が通話作成時 (billing.reserveMinutes 成功時) に
-- roomId → (userId, sessionId) を本テーブルへ保存し、
-- apps/server/src/adapters/usage-metering-subscriber.ts (translation.ended 購読者、#46) と
-- room-routes.ts の /leave (reconcile, #53) の両方がここから引く。
--
-- 旧実装は apps/server 内 in-memory Map (roomSessionMap) だったが、サーバー再起動や
-- マルチインスタンス (Vercel 等) 環境では失われるため、DB (本テーブル) に寄せた。
--
-- 所有: 本テーブルは packages/billing の ReservationRepository からは触れない
-- (「packages/billing のインターフェースは変更しない」方針のため)。あくまで
-- apps/server 層専用の roomId 解決テーブルであり、billing パッケージが所有する
-- usage_reservations / usage_windows とは独立したライフサイクルを持つ
-- (trancall_event.translation_sessions が translation モジュール所有でありながら
-- apps/server の Agent event ハンドラから直接 write される、という docs/module-contracts.md
-- §1.1 の既存パターンに倣う)。
--
-- 行は /leave 時には削除しない: leave は通常 translation.ended (Agent 経由、非同期) より先に
-- 呼ばれるため、ここで削除すると後から届く translation.ended が対応付けを見つけられず
-- recordUsage がスキップされてしまう。当面は削除せず、将来的にバッチ削除ジョブ等で
-- 古い行を掃除する運用を想定する (本 PR スコープ外)。
--
-- user_id FK は ON DELETE CASCADE とする (確定#7 / #07 リグレッション対応)。
-- 00019_relax_account_deletion_fk_constraints.sql が退会物理削除時の FK 違反を
-- 全洗い出しして対処した後、本テーブルが ON DELETE NO ACTION (デフォルト) の
-- まま追加されたため、supabase/functions/retention-cleanup/index.ts の
-- auth.admin.deleteUser() が再び FK 違反で失敗するリグレッションを引き起こしていた。
-- 本テーブルは roomId → (userId, sessionId) の一時的な glue テーブルであり
-- 退会ユーザーの行を保持する監査/課金上の価値が無いため、他の billing テーブル
-- (usage_reservations 等、NULL 化ではなく削除方針) と同様に CASCADE で
-- profiles 削除に追従させる。retention-cleanup 側でも念のため明示 DELETE の
-- フォールバックを追加している (多層防御)。
-- =============================================================================

CREATE TABLE trancall_billing.room_reservation_sessions (
  room_id     UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES trancall_auth.profiles(user_id) ON DELETE CASCADE,
  session_id  UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_room_reservation_sessions_session
  ON trancall_billing.room_reservation_sessions(session_id);

ALTER TABLE trancall_billing.room_reservation_sessions ENABLE ROW LEVEL SECURITY;

-- 通常ユーザーはアクセス不可 (service_role のみ、trancall_event.translation_sessions と同様の方針)
CREATE POLICY room_reservation_sessions_service_only
  ON trancall_billing.room_reservation_sessions
  FOR ALL
  USING (FALSE);
