/**
 * ReservationRepository インターフェース
 *
 * usage_reservations テーブルへのアクセス。
 * 実装は apps/server 側（Supabase）。
 */

import type { Result, UserId } from "@trancall/shared-kernel";
import type { TranslationSessionId } from "@trancall/shared-kernel";
import type { UsageReservation } from "../schemas";

export interface ReservationRepository {
  /**
   * 通話開始時の分数予約を作成する（status='active'）。
   */
  create(
    userId: UserId,
    sessionId: TranslationSessionId,
    reservedMinutes: number,
  ): Promise<Result<UsageReservation>>;

  /**
   * セッション ID でアクティブな予約を取得する。
   */
  findActiveBySessionId(
    sessionId: TranslationSessionId,
  ): Promise<Result<UsageReservation | null>>;

  /**
   * 予約を reconciled 状態に更新し、実消費分数を記録する。
   */
  reconcile(
    sessionId: TranslationSessionId,
    consumedMinutes: number,
  ): Promise<Result<UsageReservation>>;

  /**
   * 異常終了時の予約を expired 状態にする（refundMinutes 用）。
   */
  expire(
    sessionId: TranslationSessionId,
  ): Promise<Result<UsageReservation | null>>;
}
