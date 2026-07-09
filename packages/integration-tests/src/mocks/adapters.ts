/**
 * 外部アダプター (APNs / FCM / Stripe / AppleIAP / GooglePlay) の in-memory mock
 *
 * 結合テストでは Webhook フローは対象外のため、StripeAdapter / AppleIapAdapter /
 * GooglePlayAdapter は「何もしない」スタブとして提供する。
 * APNs / FCM は sendXxx が ok を返すだけのスタブ。
 */

import { ok, err } from "@trancall/shared-kernel";
import type { Result} from "@trancall/shared-kernel";

import type { ApnsAdapter } from "@trancall/notification";
import type { FcmAdapter } from "@trancall/notification";
import type {
  StripeAdapter,
  AppleIapAdapter,
  GooglePlayAdapter,
  StripeWebCheckoutAdapter,
  IapAdapter,
  ExternalPurchaseAdapter,
  ExternalPurchaseTokenRepository,
  CheckoutSessionViewModel,
  UpgradePreview,
  VerifiedIapTransaction,
} from "@trancall/billing";
import { createIapAdapter, createExternalPurchaseAdapter } from "@trancall/billing";

// ============================================================
// APNs mock
// ============================================================

export function makeApnsAdapter(): ApnsAdapter {
  return {
    sendVoipPush: async (_deviceToken, _payload): Promise<Result<{ apnsId: string | undefined }>> => {
      return ok({ apnsId: `mock-apns-${crypto.randomUUID()}` });
    },
    sendNormalPush: async (_deviceToken, _payload): Promise<Result<{ apnsId: string | undefined }>> => {
      return ok({ apnsId: `mock-apns-${crypto.randomUUID()}` });
    },
  };
}

// ============================================================
// FCM mock
// ============================================================

export function makeFcmAdapter(): FcmAdapter {
  return {
    sendData: async (_fcmToken, _data): Promise<Result<{ messageId: string }>> => {
      return ok({ messageId: `mock-fcm-${crypto.randomUUID()}` });
    },
    close: async (): Promise<void> => {
      // no-op
    },
  };
}

// ============================================================
// Stripe mock
// Stripe の型は billing パッケージ内でのみ使われるため、
// StripeAdapter 型に合わせたスタブを `unknown` 経由で構築する
// ============================================================

export function makeStripeAdapter(): StripeAdapter {
  // StripeAdapter = ReturnType<typeof createStripeAdapter>
  // verifyWebhook は Stripe.Event を返すが、テストでは使用しないのでエラーを返すスタブ
  return {
    createCheckoutSession: async () => ok({ url: "https://checkout.stripe.com/mock", sessionId: "sess_mock" }),
    verifyWebhook: async () => ({
      ok: false,
      error: { code: "BILLING_INVALID_RECEIPT", message: "mock: not implemented", retryable: false },
    }),
    // parseCheckoutCompleted / parseSubscriptionDeleted は sync
    parseCheckoutCompleted: () => ({
      ok: false,
      error: { code: "BILLING_INVALID_RECEIPT", message: "mock: not implemented", retryable: false },
    }),
    parseSubscriptionDeleted: () => ({
      ok: false,
      error: { code: "BILLING_INVALID_RECEIPT", message: "mock: not implemented", retryable: false },
    }),
  } as unknown as StripeAdapter;
}

// ============================================================
// Apple IAP mock
// ============================================================

export function makeAppleIapAdapter(): AppleIapAdapter {
  return {
    parseWebhookPayload: () => ({
      ok: false,
      error: { code: "BILLING_INVALID_RECEIPT", message: "mock: not implemented", retryable: false },
    }),
    shouldProcessNotification: (_type: string) => false,
  } as unknown as AppleIapAdapter;
}

// ============================================================
// Google Play mock
// ============================================================

export function makeGooglePlayAdapter(): GooglePlayAdapter {
  return {
    parseWebhookPayload: () => ({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "mock: not implemented", retryable: false },
    }),
    parseNotification: () => ({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "mock: not implemented", retryable: false },
    }),
    shouldProcessNotification: (_type: number) => false,
  } as unknown as GooglePlayAdapter;
}

// ============================================================
// StripeWebCheckoutAdapter mock
// 実アダプタは Stripe API へ実ネットワーク呼び出しを行うため、
// Checkout / Proration Preview / Session 照会いずれも成功パスの
// 妥当な値を返すスタブに差し替える。
// ============================================================

export function makeStripeWebCheckoutAdapter(): StripeWebCheckoutAdapter {
  return {
    createCheckoutSession: async (
      _userId: string,
      targetTier,
      _channel: "stripe_web" | "storekit_external",
      _customerEmail?: string,
    ): Promise<Result<CheckoutSessionViewModel>> => {
      const sessionId = `sess_mock_${crypto.randomUUID()}`;
      return ok({
        checkoutUrl: `https://checkout.stripe.com/mock/${sessionId}`,
        sessionId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        targetTier,
        returnUrl: `https://mock.trancall.app/billing/stripe-success?session_id=${sessionId}`,
      });
    },
    getUpgradePreview: async (
      _stripeSubscriptionId: string | null,
      currentTier,
      targetTier,
    ): Promise<Result<UpgradePreview>> => {
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      return ok({
        currentTier,
        targetTier,
        proratedAmountYen: 0,
        nextBillingDate: nextMonth.toISOString(),
        effectiveImmediately: true,
        confirmationRequired: true,
      });
    },
    retrieveCheckoutSession: async (sessionId: string) => {
      return ok({
        paymentStatus: "paid" as const,
        status: "complete" as const,
        subscriptionId: `sub_mock_${sessionId}`,
      });
    },
  };
}

// ============================================================
// IapAdapter mock
// resolveTier / selectLatestTransaction は純粋な同期ロジックのため
// 実装 (createIapAdapter) をそのまま再利用する。verifyIapTransaction は
// x5c 証明書チェーン検証を含み、テストで実在しない signedJws を検証できないため、
// productId マッピングのみで判定する mock に差し替える。
// ============================================================

export function makeIapAdapter(): IapAdapter {
  const real = createIapAdapter();

  return {
    resolveTier: real.resolveTier,
    selectLatestTransaction: real.selectLatestTransaction,
    verifyIapTransaction: async (transaction): Promise<Result<VerifiedIapTransaction>> => {
      const tier = real.resolveTier(transaction.productId);
      if (tier === null) {
        return err({
          code: "BILLING_IAP_RECEIPT_INVALID",
          message: `未知の Apple 製品 ID: ${transaction.productId}`,
          retryable: false,
          provider: "apple_iap",
        });
      }
      return ok({
        originalTransactionId: transaction.originalTransactionId,
        productId: transaction.productId,
        tier,
        purchaseDate: transaction.purchaseDate,
        expirationDate: transaction.expirationDate,
        isValid: true,
      });
    },
  };
}

// ============================================================
// ExternalPurchaseAdapter mock
// redirectToken の生成・検証ロジックは Apple API 報告 (console.log のみ) 以外
// 外部ネットワーク呼び出しを含まないため、実装 (createExternalPurchaseAdapter) を
// in-memory ExternalPurchaseTokenRepository と組み合わせてそのまま利用する。
// ============================================================

export function makeExternalPurchaseAdapter(
  tokenRepo: ExternalPurchaseTokenRepository,
): ExternalPurchaseAdapter {
  return createExternalPurchaseAdapter(tokenRepo, {
    redirectTokenTtlMinutes: 5,
    externalSuccessUrl: "https://mock.trancall.app/billing/external-success",
  });
}
