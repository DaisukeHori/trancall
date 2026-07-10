/**
 * SubscriptionService — サブスクリプション状態管理
 *
 * - getSubscription: サブスクリプション状態を取得（usedMinutes / remainingMinutes 計算込み）
 * - canStartCall: 通話開始可否チェック
 * - ensureSubscriptionExists: ユーザー登録時の Free プラン作成
 */

import {
  type Result,
  type UserId,
  ok,
  err,
} from "@trancall/shared-kernel";

import type { SubscriptionState } from "../schemas.ts";
import { PLAN_CONFIGS } from "../schemas.ts";
import type { SubscriptionRepository } from "../repositories/subscription-repository.ts";
import {
  calcUsedMinutes,
  calcRemainingMinutes,
} from "./plan-calculator.ts";

export interface SubscriptionServiceDeps {
  subscriptionRepo: SubscriptionRepository;
}

export function createSubscriptionService(deps: SubscriptionServiceDeps) {
  const { subscriptionRepo } = deps;

  return {
    /**
     * サブスクリプション状態を取得する。
     * usedMinutes / remainingMinutes は当期消費秒数から計算する。
     */
    async getSubscription(
      userId: UserId,
    ): Promise<Result<SubscriptionState>> {
      const rowResult = await subscriptionRepo.findByUserId(userId);
      if (!rowResult.ok) return rowResult;

      const row = rowResult.data;
      const plan = PLAN_CONFIGS[row.plan_tier];

      // 当期消費秒数を取得
      const usedSecondsResult = await subscriptionRepo.getUsedSecondsInPeriod(
        userId,
        row.current_period_start,
        row.current_period_end,
      );
      if (!usedSecondsResult.ok) return usedSecondsResult;

      const usedSeconds = usedSecondsResult.data;
      const usedMinutes = calcUsedMinutes(usedSeconds);
      const remainingMinutes = calcRemainingMinutes(plan, usedSeconds);

      const state: SubscriptionState = {
        userId,
        plan,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        usedMinutes,
        remainingMinutes,
        cancelAtPeriodEnd: row.cancel_at_period_end,
        stripeCustomerId: row.stripe_customer_id,
        stripeSubscriptionId: row.stripe_subscription_id,
        iapOriginalTransactionId: row.iap_original_transaction_id,
        iapPlatform: deriveIapPlatform(row.plan_tier, row.purchase_channel),
      };

      return ok(state);
    },

    /**
     * 通話開始前の残量チェック。
     * 残り 1 分以上 OR 支払い方法あり（超過課金プランのみ）なら true。
     * Free プランは残量 0 なら BILLING_INSUFFICIENT_BALANCE。
     */
    async canStartCall(userId: UserId): Promise<Result<true>> {
      const subResult = await subscriptionRepo.findByUserId(userId);
      if (!subResult.ok) return subResult;

      const row = subResult.data;
      const plan = PLAN_CONFIGS[row.plan_tier];

      const usedSecondsResult = await subscriptionRepo.getUsedSecondsInPeriod(
        userId,
        row.current_period_start,
        row.current_period_end,
      );
      if (!usedSecondsResult.ok) return usedSecondsResult;

      const usedSeconds = usedSecondsResult.data;
      const remainingMinutes = calcRemainingMinutes(plan, usedSeconds);

      if (remainingMinutes >= 1) {
        return ok(true);
      }

      // 超過課金ありのプランで支払い方法がある場合は通話開始許可
      if (
        plan.overageRateYen > 0 &&
        (row.stripe_subscription_id !== null ||
          row.iap_original_transaction_id !== null)
      ) {
        return ok(true);
      }

      return err({
        code: "BILLING_INSUFFICIENT_BALANCE",
        message:
          "翻訳分数が不足しています。プランをアップグレードしてください",
        retryable: false,
        httpStatus: 402,
      });
    },

    /**
     * Free プランでサブスクリプションが存在しない場合に作成する。
     */
    async ensureSubscriptionExists(
      userId: UserId,
    ): Promise<Result<SubscriptionState>> {
      const plan = PLAN_CONFIGS["free"];
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setDate(periodEnd.getDate() + 30);

      const result = await subscriptionRepo.upsert(userId, {
        plan_tier: "free",
        included_minutes: plan.includedMinutes,
        overage_rate_yen: plan.overageRateYen,
        monthly_price_yen: plan.monthlyPriceYen,
        transcript_retention_days: plan.transcriptRetentionDays,
        cancel_at_period_end: false,
        purchase_channel: "free",
        stripe_customer_id: null,
        stripe_subscription_id: null,
        iap_original_transaction_id: null,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        updated_at: now.toISOString(),
      });

      if (!result.ok) return result;

      const row = result.data;
      const state: SubscriptionState = {
        userId,
        plan,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        usedMinutes: 0,
        remainingMinutes: plan.includedMinutes,
        cancelAtPeriodEnd: false,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        iapOriginalTransactionId: null,
        iapPlatform: null,
      };

      return ok(state);
    },
  };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;

// --- ヘルパー ---

function deriveIapPlatform(
  _planTier: string,
  purchaseChannel: string,
): "apple" | "google" | null {
  if (purchaseChannel === "iap_apple") return "apple";
  if (purchaseChannel === "iap_google") return "google";
  return null;
}
