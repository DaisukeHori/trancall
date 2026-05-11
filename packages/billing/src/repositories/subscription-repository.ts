/**
 * SubscriptionRepository インターフェース
 *
 * 実装は apps/server 側（Supabase）。
 * billing パッケージは interface のみ保持し、DI で受け取る。
 */

import type { Result } from "@trancall/shared-kernel";
import type { AppError } from "@trancall/shared-kernel";
import type { UserId } from "@trancall/shared-kernel";
import type {
  SubscriptionRow,
  PlanTier,
  PurchaseChannel,
} from "../schemas.js";

export interface SubscriptionRepository {
  /**
   * ユーザーのサブスクリプション行を取得する。
   * 存在しない場合は NOT_FOUND エラーを返す。
   */
  findByUserId(userId: UserId): Promise<Result<SubscriptionRow, AppError>>;

  /**
   * サブスクリプション行を upsert する（ユーザー登録時の Free プラン作成など）。
   */
  upsert(
    userId: UserId,
    data: Partial<Omit<SubscriptionRow, "id" | "user_id" | "created_at">>,
  ): Promise<Result<SubscriptionRow, AppError>>;

  /**
   * プランティアと購入チャネル、外部 ID を更新する（Webhook 受信時）。
   */
  updatePlan(
    userId: UserId,
    params: {
      planTier: PlanTier;
      purchaseChannel: PurchaseChannel;
      stripeSubscriptionId?: string | null;
      stripeCustomerId?: string | null;
      iapOriginalTransactionId?: string | null;
      currentPeriodStart?: string;
      currentPeriodEnd?: string;
      cancelAtPeriodEnd?: boolean;
    },
  ): Promise<Result<SubscriptionRow, AppError>>;

  /**
   * 当期課金サイクル内の消費秒数合計を取得する。
   * M-002-NEW: CEIL(SUM(duration_seconds)::numeric / 60) を TS 側で計算するため、
   * 生の秒数を返す。
   */
  getUsedSecondsInPeriod(
    userId: UserId,
    periodStart: string,
    periodEnd: string,
  ): Promise<Result<number, AppError>>;
}
