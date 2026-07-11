/**
 * StripeAdapter — Stripe API 連携
 *
 * adapters/* 内では型アサーション例外許可（CLAUDE.md より）。
 *
 * 担当:
 * - Stripe Checkout Session 作成（stripe_web / storekit_external）
 * - Stripe Webhook 検証・イベントパース
 * - customer_id 管理
 *
 * M-1: アップグレードの日割りプレビュー (Stripe proration preview) は本 adapter ではなく
 * `stripe-web-checkout-adapter.ts` の `getUpgradePreview()` が担う
 * (`stripe.invoices.retrieveUpcoming` による実日割り計算・現行 tier・即時反映可否を返す実装)。
 * `BillingFacade.previewUpgrade` は `stripeWebCheckoutAdapter.getUpgradePreview` を呼ぶよう
 * 配線済み。以前ここに存在した `previewUpgrade` (proratedAmountYen:0/currentTier:'free' 固定の
 * スタブ) は facade から一度も呼ばれない死んだコードだったため削除した。
 */

import Stripe from "stripe";
import { z } from "zod";
import type { Result, AppError } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

import type { PlanTier } from "../schemas.ts";

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
  userId: z.uuid(),
  tier: z.enum(["free", "light", "standard", "business"]),
  channel: z.enum(["stripe_web", "storekit_external"]),
});

export function createStripeAdapter(config: StripeAdapterConfig) {
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
    }): Promise<Result<CreateCheckoutResult>> {
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
    ): Promise<Result<Stripe.Event>> {
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
     * current_period_start/end は Stripe Subscription API から実値を取得する
     * (#24: 従来の「now+30日」暫定値を廃止)。
     */
    async parseCheckoutCompleted(event: Stripe.Event): Promise<Result<
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
    >> {
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

      // subscription の実際の請求期間を Stripe API から取得する
      try {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const currentPeriodStart = new Date(
          subscription.current_period_start * 1000,
        ).toISOString();
        const currentPeriodEnd = new Date(
          subscription.current_period_end * 1000,
        ).toISOString();

        return ok({
          userId,
          tier,
          channel,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          currentPeriodStart,
          currentPeriodEnd,
        });
      } catch (e: unknown) {
        return mapStripeError(e);
      }
    },

    /**
     * [Sprint 2 D5] Stripe サブスクリプションをキャンセルする (#41)。
     * atPeriodEnd=true: 期末キャンセル予約 (cancel_at_period_end=true)
     * atPeriodEnd=false: 即時キャンセル。
     *   cancel_at_period_end フラグの更新だけでは Stripe 側は解約されないため、
     *   subscriptions.cancel() で即座に解約する。
     */
    async cancelSubscription(
      stripeSubscriptionId: string,
      atPeriodEnd: boolean,
    ): Promise<Result<void>> {
      try {
        if (atPeriodEnd) {
          await stripe.subscriptions.update(stripeSubscriptionId, {
            cancel_at_period_end: true,
          });
        } else {
          await stripe.subscriptions.cancel(stripeSubscriptionId);
        }
        return ok(undefined);
      } catch (e: unknown) {
        return mapStripeError(e);
      }
    },

    /**
     * [#65] 期末キャンセル予約 (cancel_at_period_end=true) を取り消し、
     * サブスクリプションを継続させる (cancelSubscription(id, atPeriodEnd=true) の対称操作)。
     * アカウント退会取消 (account-routes.ts の POST /api/account/restore) から
     * BillingFacade.reactivateSubscription 経由で呼ばれる。
     */
    async reactivateSubscription(
      stripeSubscriptionId: string,
    ): Promise<Result<void>> {
      try {
        await stripe.subscriptions.update(stripeSubscriptionId, {
          cancel_at_period_end: false,
        });
        return ok(undefined);
      } catch (e: unknown) {
        return mapStripeError(e);
      }
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

    /**
     * [#24] customer.subscription.updated イベントを解析する。
     * current_period_end 等の実値を継続更新するために使用する。
     */
    parseSubscriptionUpdated(event: Stripe.Event): Result<
      {
        stripeCustomerId: string;
        stripeSubscriptionId: string;
        currentPeriodStart: string;
        currentPeriodEnd: string;
        cancelAtPeriodEnd: boolean;
      },
      AppError
    > {
      if (event.type !== "customer.subscription.updated") {
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
      const currentPeriodStartUnix: unknown = subscription.current_period_start;
      const currentPeriodEndUnix: unknown = subscription.current_period_end;
      const cancelAtPeriodEnd: unknown = subscription.cancel_at_period_end;

      if (
        !customerId ||
        !subscriptionId ||
        typeof currentPeriodStartUnix !== "number" ||
        typeof currentPeriodEndUnix !== "number"
      ) {
        return err({
          code: "BILLING_INVALID_RECEIPT",
          message: "customer.subscription.updated イベントのフィールドが不正です",
          retryable: false,
        });
      }

      return ok({
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        currentPeriodStart: new Date(currentPeriodStartUnix * 1000).toISOString(),
        currentPeriodEnd: new Date(currentPeriodEndUnix * 1000).toISOString(),
        cancelAtPeriodEnd: cancelAtPeriodEnd === true,
      });
    },

    /**
     * [#24] invoice.paid イベントを解析する。
     * 更新分のサブスクリプション周期を current_period_end に反映するために使用する。
     */
    parseInvoicePaid(event: Stripe.Event): Result<
      {
        stripeCustomerId: string;
        stripeSubscriptionId: string;
        currentPeriodEnd: string;
      },
      AppError
    > {
      if (event.type !== "invoice.paid") {
        return err({
          code: "VALIDATION_ERROR",
          message: `想定外のイベントタイプ: ${event.type}`,
          retryable: false,
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapters/* 内は許可
      const invoice = event.data.object as any;
      const customerId =
        typeof invoice.customer === "string" ? invoice.customer : "";
      const subscriptionId =
        typeof invoice.subscription === "string" ? invoice.subscription : "";
      const periodEndUnix: unknown = invoice.period_end;

      if (!customerId || !subscriptionId || typeof periodEndUnix !== "number") {
        return err({
          code: "BILLING_INVALID_RECEIPT",
          message: "invoice.paid イベントのフィールドが不正です",
          retryable: false,
        });
      }

      return ok({
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        currentPeriodEnd: new Date(periodEndUnix * 1000).toISOString(),
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
