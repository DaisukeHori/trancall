/**
 * StripeWebCheckoutAdapter — Stripe Web Checkout フロー専用アダプタ
 *
 * docs/billing-ui-flow.md v1.2 §6 canonical 設計準拠。
 * BillingFacade.startExternalPurchase / createCheckoutSession から利用する。
 *
 * 担当:
 * - Stripe Checkout Session 作成 (stripe_web / storekit_external)
 * - CheckoutSessionViewModel 形式で返却
 * - Stripe proration preview (previewUpgrade 用)
 *
 * adapters/* 内では型アサーション例外許可 (CLAUDE.md)。
 */

import Stripe from "stripe";
import { z } from "zod";
import type { Result, AppError } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

import type { PlanTier } from "../schemas";
import type { CheckoutSessionViewModel, UpgradePreview } from "../view-models/index";

// =============================================================================
// 設定
// =============================================================================

export interface StripeWebCheckoutConfig {
  secretKey: string;
  webhookSecret: string;
  priceIds: {
    light: string;
    standard: string;
    business: string;
  };
  /** stripe-success deep link の base URL (e.g. trancall://billing/stripe-success) */
  successUrl: string;
  /** stripe-cancel deep link の base URL (e.g. trancall://billing/stripe-cancel) */
  cancelUrl: string;
}

// =============================================================================
// ファクトリ
// =============================================================================

export function createStripeWebCheckoutAdapter(config: StripeWebCheckoutConfig) {
  const stripe = new Stripe(config.secretKey, {
    apiVersion: "2025-02-24.acacia",
  });

  return {
    /**
     * Stripe Checkout Session を作成し CheckoutSessionViewModel を返す。
     * @param userId 購入ユーザー ID (Checkout Session metadata に埋め込む)
     * @param targetTier 購入目標プラン
     * @param channel 購入チャネル (stripe_web / storekit_external)
     * @param customerEmail オプション: Stripe Checkout 画面にあらかじめ表示するメール
     */
    async createCheckoutSession(
      userId: string,
      targetTier: PlanTier,
      channel: "stripe_web" | "storekit_external",
      customerEmail?: string,
    ): Promise<Result<CheckoutSessionViewModel>> {
      if (targetTier === "free") {
        return err({
          code: "BILLING_INVALID_PLAN_CHANGE",
          message: "Free プランはチェックアウト不要です",
          retryable: false,
        });
      }

      const priceId = config.priceIds[targetTier];
      if (!priceId) {
        return err({
          code: "VALIDATION_ERROR",
          message: `プラン ${targetTier} の Stripe Price ID が未設定です`,
          retryable: false,
        });
      }

      try {
        const sessionParams: Stripe.Checkout.SessionCreateParams = {
          mode: "subscription",
          line_items: [{ price: priceId, quantity: 1 }],
          // success_url は session_id を含める (deep link 戻り先)
          success_url: `${config.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: config.cancelUrl,
          metadata: {
            userId,
            tier: targetTier,
            channel,
          },
        };
        if (customerEmail !== undefined) {
          sessionParams.customer_email = customerEmail;
        }

        const session = await stripe.checkout.sessions.create(sessionParams);

        if (!session.url) {
          return err({
            code: "BILLING_PAYMENT_FAILED",
            message: "Stripe Checkout URL の取得に失敗しました",
            retryable: true,
          });
        }

        // expiresAt: Stripe Checkout Session は通常 24h で期限切れ
        const expiresAt = new Date(
          Date.now() + 24 * 60 * 60 * 1000,
        ).toISOString();

        const viewModel: CheckoutSessionViewModel = {
          checkoutUrl: session.url,
          sessionId: session.id,
          expiresAt,
          targetTier,
          returnUrl: `${config.successUrl}?session_id=${session.id}`,
        };

        return ok(viewModel);
      } catch (e: unknown) {
        return mapStripeError(e);
      }
    },

    /**
     * Stripe Proration Preview を取得し UpgradePreview を返す。
     * Free プランからの upgrade は proratedAmountYen=0 (Stripe 側で計算)。
     *
     * @param stripeSubscriptionId 既存の Stripe Subscription ID (Free プランは null)
     * @param currentTier 現在プラン
     * @param targetTier 目標プラン
     */
    async getUpgradePreview(
      stripeSubscriptionId: string | null,
      currentTier: PlanTier,
      targetTier: PlanTier,
    ): Promise<Result<UpgradePreview>> {
      if (currentTier === targetTier) {
        return err({
          code: "BILLING_INVALID_PLAN_CHANGE",
          message: "現在と同じプランへの変更はできません",
          retryable: false,
        });
      }

      // Free プランからの upgrade は proratedAmount=0 で返す
      if (stripeSubscriptionId === null || currentTier === "free") {
        const now = new Date();
        const nextMonth = new Date(now);
        nextMonth.setMonth(nextMonth.getMonth() + 1);

        const preview: UpgradePreview = {
          currentTier,
          targetTier,
          proratedAmountYen: 0,
          nextBillingDate: nextMonth.toISOString(),
          effectiveImmediately: true,
          confirmationRequired: true,
        };
        return ok(preview);
      }

      try {
        // 既存 Subscription の次回請求日取得
        const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        const nextBillingDate = new Date(
          subscription.current_period_end * 1000,
        ).toISOString();

        // 目標プランの Price ID を取得 (free はここに到達しないが型安全のため確認)
        const targetPriceId = targetTier !== "free" ? config.priceIds[targetTier] : undefined;
        if (!targetPriceId) {
          return err({
            code: "BILLING_UPGRADE_PREVIEW_FAILED",
            message: `プラン ${targetTier} の Stripe Price ID が未設定です`,
            retryable: false,
          });
        }

        // Stripe proration preview
        const subscriptionItem = subscription.items.data[0];
        if (subscriptionItem === undefined) {
          return err({
            code: "BILLING_UPGRADE_PREVIEW_FAILED",
            message: "Stripe Subscription の items が取得できません",
            retryable: true,
          });
        }

        const invoice = await stripe.invoices.retrieveUpcoming({
          subscription: stripeSubscriptionId,
          subscription_items: [
            {
              id: subscriptionItem.id,
              price: targetPriceId,
            },
          ],
          subscription_proration_behavior: "create_prorations",
        });

        // 日割り差額 (amount_due が負の場合は 0)
        const proratedAmountYen = Math.max(0, invoice.amount_due);

        const preview: UpgradePreview = {
          currentTier,
          targetTier,
          proratedAmountYen,
          nextBillingDate,
          effectiveImmediately: true,
          confirmationRequired: true,
        };

        return ok(preview);
      } catch (e: unknown) {
        return mapStripeError(e, "BILLING_UPGRADE_PREVIEW_FAILED");
      }
    },

    /**
     * [#44] Stripe Checkout Session を照会し、決済完了状態を確認する。
     * External Purchase 完了処理 (completeExternalPurchase) で、クライアントの
     * 自己申告値 (redirect.stripeSubscriptionId) を信用せず、Stripe 側の実状態を
     * 正とするために使用する。
     */
    async retrieveCheckoutSession(
      sessionId: string,
    ): Promise<
      Result<{
        paymentStatus: Stripe.Checkout.Session.PaymentStatus;
        status: Stripe.Checkout.Session.Status | null;
        subscriptionId: string | null;
      }>
    > {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : null;

        return ok({
          paymentStatus: session.payment_status,
          status: session.status,
          subscriptionId,
        });
      } catch (e: unknown) {
        return mapStripeError(e, "BILLING_PAYMENT_FAILED");
      }
    },
  };
}

export type StripeWebCheckoutAdapter = ReturnType<
  typeof createStripeWebCheckoutAdapter
>;

// =============================================================================
// エラーマッピング
// =============================================================================

function mapStripeError(
  e: unknown,
  defaultCode = "BILLING_PAYMENT_FAILED",
): { ok: false; error: AppError } {
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
      code: defaultCode,
      message: `Stripe API エラー: ${e.message}`,
      retryable: true,
      provider: "stripe",
    });
  }
  const msg = e instanceof Error ? e.message : String(e);
  return err({
    code: defaultCode,
    message: msg,
    retryable: true,
    provider: "stripe",
  });
}

// =============================================================================
// Zod スキーマ (UpgradePreview レスポンス検証用)
// =============================================================================

export const StripeInvoiceUpcomingSchema = z.object({
  amount_due: z.number(),
  currency: z.string(),
});
