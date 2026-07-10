/**
 * UsageMeteringService — heartbeat 受信と usage_window 記録
 *
 * billing-detail.md の heartbeat フローに準拠:
 * 1. SubscriptionState 取得（overage_rate_yen / remaining_seconds 算出）
 * 2. amount_yen 計算（含有分/超過/跨ぎ window）
 * 3. usage_windows に冪等 INSERT
 * 4. shouldContinue 判定
 */

import {
  type Result,
  ok,
  err,
} from "@trancall/shared-kernel";

import type {
  SubscriptionState,
  RecordUsageCommand,
} from "../schemas";
import { PLAN_CONFIGS } from "../schemas";
import type { SubscriptionRepository } from "../repositories/subscription-repository";
import type { UsageRepository } from "../repositories/usage-repository";
import {
  calcAmountYen,
  calcRemainingSeconds,
  calcUsedMinutes,
  calcRemainingMinutes,
} from "./plan-calculator";

export interface RecordUsageResult {
  subscriptionState: SubscriptionState;
  amountYen: number;
  shouldContinue: boolean;
}

export interface UsageMeteringServiceDeps {
  subscriptionRepo: SubscriptionRepository;
  usageRepo: UsageRepository;
}

export function createUsageMeteringService(deps: UsageMeteringServiceDeps) {
  const { subscriptionRepo, usageRepo } = deps;

  return {
    /**
     * heartbeat ウィンドウを記録し、SubscriptionState を更新して返す。
     */
    async recordUsage(
      cmd: RecordUsageCommand,
    ): Promise<Result<RecordUsageResult>> {
      // 1. サブスクリプション取得
      const subResult = await subscriptionRepo.findByUserId(cmd.userId);
      if (!subResult.ok) {
        return err({
          code: "BILLING_SUBSCRIPTION_EXPIRED",
          message: "サブスクリプションが期限切れです",
          retryable: false,
          httpStatus: 402,
        });
      }

      const row = subResult.data;
      const plan = PLAN_CONFIGS[row.plan_tier];

      // 2. 当期消費秒数を取得
      const usedSecondsResult = await subscriptionRepo.getUsedSecondsInPeriod(
        cmd.userId,
        row.current_period_start,
        row.current_period_end,
      );
      if (!usedSecondsResult.ok) return usedSecondsResult;

      const usedSeconds = usedSecondsResult.data;
      const remainingSeconds = calcRemainingSeconds(plan, usedSeconds);

      // 3. amount_yen を計算
      const amountResult = calcAmountYen(
        plan,
        remainingSeconds,
        cmd.durationSeconds,
      );

      // 4. usage_windows に冪等 INSERT
      const insertResult = await usageRepo.insertWindowIdempotent(
        cmd,
        amountResult.amountYen,
      );
      if (!insertResult.ok) return insertResult;

      // 5. 挿入後の残量を再計算（新しい window の秒数を加算）
      const newUsedSeconds = usedSeconds + cmd.durationSeconds;
      const newUsedMinutes = calcUsedMinutes(newUsedSeconds);
      const newRemainingMinutes = calcRemainingMinutes(plan, newUsedSeconds);
      const newRemainingSeconds = calcRemainingSeconds(plan, newUsedSeconds);

      // 6. shouldContinue 判定
      const hasPaymentMethod =
        row.stripe_subscription_id !== null ||
        row.iap_original_transaction_id !== null;
      const continuable =
        newRemainingSeconds > 0 ||
        (plan.overageRateYen > 0 && hasPaymentMethod);

      const state: SubscriptionState = {
        userId: cmd.userId,
        plan,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        usedMinutes: newUsedMinutes,
        remainingMinutes: newRemainingMinutes,
        cancelAtPeriodEnd: row.cancel_at_period_end,
        stripeCustomerId: row.stripe_customer_id,
        stripeSubscriptionId: row.stripe_subscription_id,
        iapOriginalTransactionId: row.iap_original_transaction_id,
        iapPlatform: deriveIapPlatform(row.purchase_channel),
      };

      return ok({
        subscriptionState: state,
        amountYen: amountResult.amountYen,
        shouldContinue: continuable,
      });
    },
  };
}

export type UsageMeteringService = ReturnType<
  typeof createUsageMeteringService
>;

// --- ヘルパー ---

function deriveIapPlatform(
  purchaseChannel: string,
): "apple" | "google" | null {
  if (purchaseChannel === "iap_apple") return "apple";
  if (purchaseChannel === "iap_google") return "google";
  return null;
}
