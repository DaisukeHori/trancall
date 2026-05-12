/**
 * ReservationService — 通話開始時の分数予約と精算
 *
 * billing-detail.md の reservation → heartbeat → reconcile シーケンスに準拠:
 * - reserveMinutesWithSession: 残量チェック → usage_reservations INSERT (status='active')
 * - reconcile: 実消費と予約の差分精算
 * - refundMinutes: 異常終了時の予約解放
 */

import {
  type Result,
  type UserId,
  type TranslationSessionId,
  ok,
  err,
} from "@trancall/shared-kernel";

import type { SubscriptionState } from "../schemas.js";
import { PLAN_CONFIGS } from "../schemas.js";
import type { SubscriptionRepository } from "../repositories/subscription-repository.js";
import type { UsageRepository } from "../repositories/usage-repository.js";
import type { ReservationRepository } from "../repositories/reservation-repository.js";
import {
  calcUsedMinutes,
  calcRemainingMinutes,
} from "./plan-calculator.js";

export interface ReservationServiceDeps {
  subscriptionRepo: SubscriptionRepository;
  usageRepo: UsageRepository;
  reservationRepo: ReservationRepository;
}

export function createReservationService(deps: ReservationServiceDeps) {
  const { subscriptionRepo, usageRepo, reservationRepo } = deps;

  return {
    /**
     * 通話開始時の分数予約。
     * M-002-NEW: CEIL(SUM::numeric/60) で整数除算回避。
     *
     * 1. 残量チェック（当期消費量と含有分を比較）
     * 2. remaining >= 1 なら予約作成（LEAST(5, remaining) 分）
     * 3. remaining < 1 なら BILLING_INSUFFICIENT_BALANCE
     */
    async reserveMinutesWithSession(
      userId: UserId,
      sessionId: TranslationSessionId,
      minutes: number,
    ): Promise<Result<true>> {
      const subResult = await subscriptionRepo.findByUserId(userId);
      if (!subResult.ok) {
        return err({
          code: "BILLING_INSUFFICIENT_BALANCE",
          message:
            "翻訳分数が不足しています。プランをアップグレードしてください",
          retryable: false,
          httpStatus: 402,
        });
      }

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

      if (remainingMinutes < 1) {
        const hasPaymentMethod =
          row.stripe_subscription_id !== null ||
          row.iap_original_transaction_id !== null;
        if (!(plan.overageRateYen > 0 && hasPaymentMethod)) {
          return err({
            code: "BILLING_INSUFFICIENT_BALANCE",
            message:
              "翻訳分数が不足しています。プランをアップグレードしてください",
            retryable: false,
            httpStatus: 402,
          });
        }
      }

      const toReserve = Math.max(1, Math.min(minutes, remainingMinutes));
      const reserveResult = await reservationRepo.create(
        userId,
        sessionId,
        toReserve,
      );
      if (!reserveResult.ok) return reserveResult;

      return ok(true);
    },

    /**
     * 通話終了時の精算。
     * 実消費秒数 = usage_windows の SUM(duration_seconds)
     * consumed_minutes = CEIL(実消費秒数 / 60)
     */
    async reconcile(
      userId: UserId,
      sessionId: TranslationSessionId,
    ): Promise<Result<SubscriptionState>> {
      // 1. 当該セッションの usage_windows を集計
      const windowsResult = await usageRepo.findBySessionId(sessionId);
      if (!windowsResult.ok) return windowsResult;

      const totalSeconds = windowsResult.data.reduce(
        (sum, w) => sum + w.durationSeconds,
        0,
      );
      const consumedMinutes = Math.ceil(totalSeconds / 60);

      // 2. 予約を reconciled に更新
      const reconResult = await reservationRepo.reconcile(
        sessionId,
        consumedMinutes,
      );
      if (!reconResult.ok) return reconResult;

      // 3. 最新のサブスクリプション状態を返す
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

      const state: SubscriptionState = {
        userId,
        plan,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        usedMinutes: calcUsedMinutes(usedSeconds),
        remainingMinutes: calcRemainingMinutes(plan, usedSeconds),
        cancelAtPeriodEnd: row.cancel_at_period_end,
        stripeCustomerId: row.stripe_customer_id,
        stripeSubscriptionId: row.stripe_subscription_id,
        iapOriginalTransactionId: row.iap_original_transaction_id,
        iapPlatform: deriveIapPlatform(row.purchase_channel),
      };

      return ok(state);
    },

    /**
     * 異常終了時の予約解放。
     * usage_reservations の status を 'expired' に更新する。
     */
    async refundMinutes(
      sessionId: TranslationSessionId,
    ): Promise<Result<true>> {
      const result = await reservationRepo.expire(sessionId);
      if (!result.ok) return result;
      return ok(true);
    },
  };
}

export type ReservationService = ReturnType<typeof createReservationService>;

// --- ヘルパー ---

function deriveIapPlatform(
  purchaseChannel: string,
): "apple" | "google" | null {
  if (purchaseChannel === "iap_apple") return "apple";
  if (purchaseChannel === "iap_google") return "google";
  return null;
}
