/**
 * StripeAdapter — Stripe API 連携
 *
 * adapters/* 内では型アサーション例外許可（CLAUDE.md より）。
 *
 * 担当:
 * - Stripe Checkout Session 作成（stripe_web / storekit_external）
 * - Stripe Webhook 検証・イベントパース
 * - customer_id 管理
 */

import Stripe from "stripe";
import { z } from "zod";
import type { Result, AppError } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

import type { PlanTier } from "../schemas.js";

// Stripe の Price ID マッピング（環境変数から取得）
export interface StripePriceIds {
  light: string;
  standard: string;
  business: string;
}

export interface StripeAdapterConfig {
  secretKey: string;
  webhookSecret: string;
  priceIds: StripePriceIds;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateCheckoutResult {
  url: string;
  sessionId: string;
}

// Stripe Checkout Session 作成時のメタデータスキーマ（検証用）
const CheckoutMetadataSchema = z.object({
  userId: z.string().uuid(),
  tier: z.enum(["free", "light", "standard", "business"]),
  channel: z.enum(["stripe_web", "storekit_external"]),
});

export function createStripeAdapter(config: StripeAdapterConfig) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- adapters/* 内は許可
  const stripe = new Stripe(config.secretKey, {
    apiVersion: "2025-02-24.acacia",
  });

  return {
    /**
     * Stripe Checkout Session を作成する。
     */
    async createCheckoutSession(params: {
      userId: string;
      tier: PlanTier;
      channel: "stripe_web" | "storekit_external";
      customerEmail?: string;
      successUrl?: string;
      cancelUrl?: string;
    }): Promise<Result<CreateCheckoutResult, AppError>> {
      if (params.tier === "free") {
        return err({
          code: "VALIDATION_ERROR",
          message: "Free プランはチェックアウト不要です",
          retryable: false,
        });
      }

      const priceId = config.priceIds[params.tier];
      if (!priceId) {
        return err({
          code: "VALIDATION_ERROR",
          message: `プラン ${params.tier} の Price ID が設定されていません`,
          retryable: false,
        });
      }

      try {
        const sessionParams: Stripe.Checkout.SessionCreateParams = {
          mode: "subscription",
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: params.successUrl ?? config.successUrl,
          cancel_url: params.cancelUrl ?? config.cancelUrl,
          metadata: {
            userId: params.userId,
            tier: params.tier,
            channel: params.channel,
          },
        };
        // exactOptionalPropertyTypes 対応: undefined を渡さない
        if (params.customerEmail !== undefined) {
          sessionParams.customer_email = params.customerEmail;
        }
        const session = await stripe.checkout.sessions.create(sessionParams);

        if (!session.url) {
          return err({
            code: "BILLING_PAYMENT_FAILED",
            message: "Stripe Checkout URL の取得に失敗しました",
            retryable: true,
            httpStatus: 402,
          });
        }

        return ok({
          url: session.url,
          sessionId: session.id,
        });
      } catch (e: unknown) {
        return mapStripeError(e);
      }
    },

    /**
     * Stripe Webhook の署名を検証してイベントを取得する。
     */
    async verifyWebhook(
      rawBody: string,
      signature: string,
    ): Promise<Result<Stripe.Event, AppError>> {
      try {
        const event = stripe.webhooks.constructEvent(
          rawBody,
          signature,
          config.webhookSecret,
        );
        return ok(event);
      } catch (e: unknown) {
        return err({
          code: "BILLING_INVALID_RECEIPT",
          message:
            e instanceof Error
              ? `Stripe webhook 署名検証失敗: ${e.message}`
              : "Stripe webhook 署名検証失敗",
          retryable: false,
          httpStatus: 400,
        });
      }
    },

    /**
     * checkout.session.completed イベントからサブスクリプション情報を抽出する。
     */
    parseCheckoutCompleted(event: Stripe.Event): Result<
      {
        userId: string;
        tier: PlanTier;
        channel: "stripe_web" | "storekit_external";
        stripeCustomerId: string;
        stripeSubscriptionId: string;
        currentPeriodStart: string;
        currentPeriodEnd: string;
      },
      AppError
    > {
      if (event.type !== "checkout.session.completed") {
        return err({
          code: "VALIDATION_ERROR",
          message: `想定外のイベントタイプ: ${event.type}`,
          retryable: false,
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapters/* 内は許可
      const session = event.data.object as any;
      const metadataResult = CheckoutMetadataSchema.safeParse(
        session.metadata,
      );
      if (!metadataResult.success) {
        return err({
          code: "BILLING_INVALID_RECEIPT",
          message: "Checkout Session メタデータが不正です",
          retryable: false,
          details: {
            issues: metadataResult.error.issues.map((i) => i.message),
          },
        });
      }

      const { userId, tier, channel } = metadataResult.data;
      const customerId =
        typeof session.customer === "string" ? session.customer : "";
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : "";

      if (!customerId || !subscriptionId) {
        return err({
          code: "BILLING_PAYMENT_FAILED",
          message: "Stripe customer_id または subscription_id が取得できません",
          retryable: true,
        });
      }

      // subscription の current_period は別途 Stripe API で取得が必要だが、
      // ここでは現在時刻 + 30日を暫定値として使用
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setDate(periodEnd.getDate() + 30);

      return ok({
        userId,
        tier,
        channel,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
      });
    },

    /**
     * customer.subscription.deleted イベントを解析してユーザー ID を取得する。
     */
    parseSubscriptionDeleted(event: Stripe.Event): Result<
      {
        stripeCustomerId: string;
        stripeSubscriptionId: string;
      },
      AppError
    > {
      if (event.type !== "customer.subscription.deleted") {
        return err({
          code: "VALIDATION_ERROR",
          message: `想定外のイベントタイプ: ${event.type}`,
          retryable: false,
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapters/* 内は許可
      const subscription = event.data.object as any;
      const customerId =
        typeof subscription.customer === "string" ? subscription.customer : "";
      const subscriptionId =
        typeof subscription.id === "string" ? subscription.id : "";

      if (!customerId || !subscriptionId) {
        return err({
          code: "BILLING_INVALID_RECEIPT",
          message: "subscription イベントの customer/id が不正です",
          retryable: false,
        });
      }

      return ok({
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
      });
    },
  };
}

export type StripeAdapter = ReturnType<typeof createStripeAdapter>;

// --- エラーマッピング ---

function mapStripeError(e: unknown): { ok: false; error: AppError } {
  if (e instanceof Stripe.errors.StripeCardError) {
    return err({
      code: "BILLING_PAYMENT_FAILED",
      message: "カード決済に失敗しました",
      retryable: true,
      httpStatus: 402,
      provider: "stripe",
      details: { stripeCode: e.code },
    });
  }
  if (e instanceof Stripe.errors.StripeInvalidRequestError) {
    return err({
      code: "VALIDATION_ERROR",
      message: `Stripe リクエストエラー: ${e.message}`,
      retryable: false,
      provider: "stripe",
    });
  }
  if (e instanceof Stripe.errors.StripeAPIError) {
    return err({
      code: "INTERNAL_ERROR",
      message: `Stripe API エラー: ${e.message}`,
      retryable: true,
      provider: "stripe",
    });
  }
  return err({
    code: "INTERNAL_ERROR",
    message: e instanceof Error ? e.message : "不明なエラー",
    retryable: true,
    provider: "stripe",
  });
}
