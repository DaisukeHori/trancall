/**
 * SubscriptionRepository インターフェース
 *
 * 実装は apps/server 側（Supabase）。
 * billing パッケージは interface のみ保持し、DI で受け取る。
 */

import type { Result } from "@trancall/shared-kernel";
import type { UserId } from "@trancall/shared-kernel";
import type {
  SubscriptionRow,
  PlanTier,
  PurchaseChannel,
} from "../schemas.ts";

export interface SubscriptionRepository {
  /**
   * ユーザーのサブスクリプション行を取得する。
   * 存在しない場合は NOT_FOUND エラーを返す。
   */
  findByUserId(userId: UserId): Promise<Result<SubscriptionRow>>;

  /**
   * サブスクリプション行を upsert する（ユーザー登録時の Free プラン作成など）。
   */
  upsert(
    userId: UserId,
    data: Partial<Omit<SubscriptionRow, "id" | "user_id" | "created_at">>,
  ): Promise<Result<SubscriptionRow>>;

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
  ): Promise<Result<SubscriptionRow>>;

  /**
   * 当期課金サイクル内の消費秒数合計を取得する。
   * M-002-NEW: CEIL(SUM(duration_seconds)::numeric / 60) を TS 側で計算するため、
   * 生の秒数を返す。
   */
  getUsedSecondsInPeriod(
    userId: UserId,
    periodStart: string,
    periodEnd: string,
  ): Promise<Result<number>>;

  /**
   * [#40] iap_original_transaction_id で既存のサブスクリプション行を検索する。
   * updatePlan (UPDATE) 実行前の冪等重複排除チェックに使用する
   * (DB 側の UNIQUE 制約は別ワークストリームが追加する想定)。
   * 見つからない場合はエラーではなく `ok(null)` を返す。
   *
   * オプショナルメソッド: 未実装の repository では facade 側の
   * pre-check がスキップされ、updatePlan の Result エラー
   * (unique/duplicate 検知) のみで冪等性を担保する。
   */
  findByIapOriginalTransactionId?(
    transactionId: string,
  ): Promise<Result<SubscriptionRow | null>>;

  /**
   * [#24] stripe_subscription_id で既存のサブスクリプション行を検索する。
   * Stripe ライフサイクル Webhook (customer.subscription.updated/deleted, invoice.paid)
   * から対象ユーザーを特定するために使用する。
   * 見つからない場合はエラーではなく `ok(null)` を返す。
   *
   * オプショナルメソッド: 未実装の repository では該当 Webhook の
   * ライフサイクル同期がスキップされる (facade 側で警告ログを出力する)。
   */
  findByStripeSubscriptionId?(
    stripeSubscriptionId: string,
  ): Promise<Result<SubscriptionRow | null>>;
}
