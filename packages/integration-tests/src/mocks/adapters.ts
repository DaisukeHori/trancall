/**
 * 外部アダプター (APNs / FCM / Stripe / AppleIAP / GooglePlay) の in-memory mock
 *
 * 結合テストでは Webhook フローは対象外のため、StripeAdapter / AppleIapAdapter /
 * GooglePlayAdapter は「何もしない」スタブとして提供する。
 * APNs / FCM は sendXxx が ok を返すだけのスタブ。
 */

import { ok } from "@trancall/shared-kernel";
import type { Result, AppError } from "@trancall/shared-kernel";

import type { ApnsAdapter } from "@trancall/notification";
import type { FcmAdapter } from "@trancall/notification";
import type { StripeAdapter, AppleIapAdapter, GooglePlayAdapter } from "@trancall/billing";

// ============================================================
// APNs mock
// ============================================================

export function makeApnsAdapter(): ApnsAdapter {
  return {
    sendVoipPush: async (_deviceToken, _payload): Promise<Result<{ apnsId: string | undefined }, AppError>> => {
      return ok({ apnsId: `mock-apns-${crypto.randomUUID()}` });
    },
    sendNormalPush: async (_deviceToken, _payload): Promise<Result<{ apnsId: string | undefined }, AppError>> => {
      return ok({ apnsId: `mock-apns-${crypto.randomUUID()}` });
    },
  };
}

// ============================================================
// FCM mock
// ============================================================

export function makeFcmAdapter(): FcmAdapter {
  return {
    sendData: async (_fcmToken, _data): Promise<Result<{ messageId: string }, AppError>> => {
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
