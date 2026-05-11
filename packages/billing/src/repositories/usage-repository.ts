/**
 * UsageRepository インターフェース
 *
 * usage_windows テーブルへのアクセス。
 * 実装は apps/server 側（Supabase）。
 */

import type { Result, AppError, UserId } from "@trancall/shared-kernel";
import type { TranslationSessionId } from "@trancall/shared-kernel";
import type { UsageWindow, RecordUsageCommand } from "../schemas.js";

export interface UsageRepository {
  /**
   * heartbeat ウィンドウを冪等 INSERT する。
   * idempotency_key が既存の場合は INSERT をスキップし成功を返す。
   */
  insertWindowIdempotent(
    cmd: RecordUsageCommand,
    amountYen: number,
  ): Promise<Result<UsageWindow, AppError>>;

  /**
   * セッション内の全ウィンドウを取得する（reconcile 用）。
   */
  findBySessionId(
    sessionId: TranslationSessionId,
  ): Promise<Result<UsageWindow[], AppError>>;

  /**
   * 当期課金サイクル内の消費秒数合計を取得する。
   */
  sumDurationSecondsInPeriod(
    userId: UserId,
    periodStart: string,
    periodEnd: string,
  ): Promise<Result<number, AppError>>;
}
