/**
 * UsageRepository インターフェース
 *
 * usage_windows テーブルへのアクセス。
 * 実装は apps/server 側（Supabase）。
 */

import type { Result, UserId } from "@trancall/shared-kernel";
import type { TranslationSessionId } from "@trancall/shared-kernel";
import type { UsageWindow, RecordUsageCommand } from "../schemas";

export interface UsageRepository {
  /**
   * heartbeat ウィンドウを冪等 INSERT する。
   * idempotency_key が既存の場合は INSERT をスキップし成功を返す。
   */
  insertWindowIdempotent(
    cmd: RecordUsageCommand,
    amountYen: number,
  ): Promise<Result<UsageWindow>>;

  /**
   * セッション内の全ウィンドウを取得する（reconcile 用）。
   */
  findBySessionId(
    sessionId: TranslationSessionId,
  ): Promise<Result<UsageWindow[]>>;

  /**
   * 当期課金サイクル内の消費秒数合計を取得する。
   */
  sumDurationSecondsInPeriod(
    userId: UserId,
    periodStart: string,
    periodEnd: string,
  ): Promise<Result<number>>;
}
