/**
 * SubscriptionRepository — Supabase 実装
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SubscriptionRepository } from "@trancall/billing";
import { SubscriptionRow, PlanTier, PurchaseChannel, PLAN_CONFIGS } from "@trancall/billing";
import type { SubscriptionRowType, PlanTierType, PurchaseChannelType } from "@trancall/billing";
import { type Result, type UserId, err, ok } from "@trancall/shared-kernel";
import type { AppError } from "@trancall/shared-kernel";

export function createSubscriptionRepository(
  supabase: SupabaseClient,
): SubscriptionRepository {
  return {
    async findByUserId(userId: UserId): Promise<Result<SubscriptionRowType, AppError>> {
      const { data, error } = await supabase
        .schema("trancall_billing")
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          return err({
            code: "NOT_FOUND",
            message: `サブスクリプションが見つかりません: ${userId}`,
            retryable: false,
          });
        }
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }

      const parsed = SubscriptionRow.safeParse(data);
      if (!parsed.success) {
        return err({
          code: "INTERNAL_ERROR",
          message: "DB から取得したサブスクリプションのスキーマが不正です",
          retryable: false,
        });
      }
      return ok(parsed.data);
    },

    async upsert(
      userId: UserId,
      data: Partial<Omit<SubscriptionRowType, "id" | "user_id" | "created_at">>,
    ): Promise<Result<SubscriptionRowType, AppError>> {
      const tier: PlanTierType = (data["plan_tier"] as PlanTierType | undefined) ?? "free";
      const planConfig = PLAN_CONFIGS[tier];
      const now = new Date().toISOString();

      const row = {
        user_id: userId,
        plan_tier: tier,
        included_minutes: planConfig.includedMinutes,
        overage_rate_yen: planConfig.overageRateYen,
        monthly_price_yen: planConfig.monthlyPriceYen,
        transcript_retention_days: planConfig.transcriptRetentionDays,
        purchase_channel: (data["purchase_channel"] as PurchaseChannelType | undefined) ?? "free",
        cancel_at_period_end: data["cancel_at_period_end"] ?? false,
        stripe_customer_id: data["stripe_customer_id"] ?? null,
        stripe_subscription_id: data["stripe_subscription_id"] ?? null,
        iap_original_transaction_id: data["iap_original_transaction_id"] ?? null,
        current_period_start: data["current_period_start"] ?? now,
        current_period_end: data["current_period_end"] ?? now,
        updated_at: now,
        ...data,
      };

      const { data: result, error } = await supabase
        .schema("trancall_billing")
        .from("subscriptions")
        .upsert(row, { onConflict: "user_id" })
        .select()
        .single();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      const parsed = SubscriptionRow.safeParse(result);
      if (!parsed.success) {
        return err({ code: "INTERNAL_ERROR", message: "upsert 後スキーマ不正", retryable: false });
      }
      return ok(parsed.data);
    },

    async updatePlan(
      userId: UserId,
      params: {
        planTier: PlanTierType;
        purchaseChannel: PurchaseChannelType;
        stripeSubscriptionId?: string | null;
        stripeCustomerId?: string | null;
        iapOriginalTransactionId?: string | null;
        currentPeriodStart?: string;
        currentPeriodEnd?: string;
        cancelAtPeriodEnd?: boolean;
      },
    ): Promise<Result<SubscriptionRowType, AppError>> {
      const planConfig = PLAN_CONFIGS[params.planTier];
      const { data, error } = await supabase
        .schema("trancall_billing")
        .from("subscriptions")
        .update({
          plan_tier: params.planTier,
          included_minutes: planConfig.includedMinutes,
          overage_rate_yen: planConfig.overageRateYen,
          monthly_price_yen: planConfig.monthlyPriceYen,
          transcript_retention_days: planConfig.transcriptRetentionDays,
          purchase_channel: params.purchaseChannel,
          stripe_subscription_id: params.stripeSubscriptionId ?? null,
          stripe_customer_id: params.stripeCustomerId ?? null,
          iap_original_transaction_id: params.iapOriginalTransactionId ?? null,
          current_period_start: params.currentPeriodStart,
          current_period_end: params.currentPeriodEnd,
          cancel_at_period_end: params.cancelAtPeriodEnd ?? false,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .select()
        .single();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      const parsed = SubscriptionRow.safeParse(data);
      if (!parsed.success) {
        return err({ code: "INTERNAL_ERROR", message: "updatePlan 後スキーマ不正", retryable: false });
      }
      return ok(parsed.data);
    },

    async getUsedSecondsInPeriod(
      userId: UserId,
      periodStart: string,
      periodEnd: string,
    ): Promise<Result<number, AppError>> {
      const { data, error } = await supabase
        .schema("trancall_billing")
        .from("usage_windows")
        .select("duration_seconds")
        .eq("user_id", userId)
        .gte("window_start", periodStart)
        .lte("window_end", periodEnd);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }

      const total = (data as Array<{ duration_seconds: number }>).reduce(
        (sum, row) => sum + (row["duration_seconds"] ?? 0),
        0,
      );
      return ok(total);
    },
  };
}
