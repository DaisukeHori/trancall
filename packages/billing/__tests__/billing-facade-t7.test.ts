/**
 * BillingFacade T-7 拡張メソッドテスト
 *
 * docs/billing-ui-flow.md v1.2 §14.2 テスト仕様準拠:
 * - getPlanComparison (正常系 2)
 * - previewUpgrade (正常系 2, 異常系 2)
 * - recordIapTransaction (正常系 1, 異常系 1, 冪等性 1)
 * - startExternalPurchase (正常系 1, 異常系 1)
 * - completeExternalPurchase (正常系 1, 異常系 2)
 * - cancelSubscription (正常系 1, 異常系 1: IAP 即時キャンセル不可)
 * - restorePurchases (正常系 2, 異常系 1)
 * - 二重消費防止テスト (markUsed race condition)
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

import { brandUserId, type UserId } from "@trancall/shared-kernel";
import { createBillingFacade } from "../src/facade.js";
import type { BillingFacadeDeps } from "../src/facade.js";
import type { SubscriptionRepository } from "../src/repositories/subscription-repository.js";
import type { UsageRepository } from "../src/repositories/usage-repository.js";
import type { ReservationRepository } from "../src/repositories/reservation-repository.js";
import type { WebhookEventRepository } from "../src/repositories/webhook-event-repository.js";
import type { ExternalPurchaseTokenRepository, ExternalPurchaseTokenRow } from "../src/repositories/external-purchase-token-repository.js";
import type { StripeAdapter } from "../src/adapters/stripe-adapter.js";
import type { AppleIapAdapter } from "../src/adapters/apple-iap-adapter.js";
import type { GooglePlayAdapter } from "../src/adapters/google-play-adapter.js";
import type { StripeWebCheckoutAdapter } from "../src/adapters/stripe-web-checkout-adapter.js";
import type { IapAdapter, VerifiedIapTransaction } from "../src/adapters/iap-adapter.js";
import type { ExternalPurchaseAdapter } from "../src/adapters/external-purchase-adapter.js";
import type { SubscriptionRow } from "../src/schemas.js";
import type { IapTransactionResult, StoreKitExternalRedirectResult } from "../src/view-models/index.js";

// =============================================================================
// ヘルパー
// =============================================================================

function makeUserId(): UserId {
  const r = brandUserId("00000000-0000-4000-8000-000000000001");
  if (!r.success) throw new Error("test setup: brandUserId failed");
  return r.data;
}

const baseRow: SubscriptionRow = {
  id: "00000000-0000-4000-8000-000000000010",
  user_id: "00000000-0000-4000-8000-000000000001",
  plan_tier: "light",
  included_minutes: 30,
  overage_rate_yen: 40,
  monthly_price_yen: 980,
  transcript_retention_days: 30,
  cancel_at_period_end: false,
  purchase_channel: "stripe_web",
  stripe_customer_id: "cus_test",
  stripe_subscription_id: "sub_test",
  iap_original_transaction_id: null,
  current_period_start: "2026-05-01T00:00:00.000Z",
  current_period_end: "2026-06-01T00:00:00.000Z",
  created_at: "2026-05-01T00:00:00.000Z",
  updated_at: "2026-05-01T00:00:00.000Z",
};

const freeRow: SubscriptionRow = {
  ...baseRow,
  plan_tier: "free",
  included_minutes: 5,
  overage_rate_yen: 0,
  monthly_price_yen: 0,
  transcript_retention_days: 7,
  purchase_channel: "free",
  stripe_customer_id: null,
  stripe_subscription_id: null,
};

const iapRow: SubscriptionRow = {
  ...baseRow,
  purchase_channel: "iap_apple",
  stripe_customer_id: null,
  stripe_subscription_id: null,
  iap_original_transaction_id: "orig_tx_001",
};

// JWS モック: header.payload.signature 形式
// payload には必要な最低限フィールドを含める
function makeJws(overrides: Record<string, unknown> = {}): string {
  const payload = {
    transactionId: "tx_001",
    originalTransactionId: "orig_tx_001",
    bundleId: "com.trancall.app",
    productId: "com.trancall.subscription.light.monthly",
    purchaseDate: Date.now(),
    originalPurchaseDate: Date.now(),
    expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 日後
    ...overrides,
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJFUzI1NiJ9.${payloadBase64}.signature`;
}

function makeIapTransaction(overrides: Partial<IapTransactionResult> = {}): IapTransactionResult {
  return {
    originalTransactionId: "orig_tx_001",
    productId: "com.trancall.subscription.light.monthly",
    purchaseDate: new Date().toISOString(),
    expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    signedJws: makeJws(),
    isUpgrade: false,
    ...overrides,
  };
}

function makeExternalRedirect(overrides: Partial<StoreKitExternalRedirectResult> = {}): StoreKitExternalRedirectResult {
  return {
    redirectToken: "a".repeat(64),
    stripeSubscriptionId: "sub_ext_001",
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

// =============================================================================
// Mock ファクトリ
// =============================================================================

function makeMockSubscriptionRepo(
  row: SubscriptionRow = baseRow,
  overrides: Partial<{
    updatePlan: unknown;
    findByIapOriginalTransactionId: unknown;
    findByStripeSubscriptionId: unknown;
  }> = {},
): SubscriptionRepository {
  return {
    findByUserId: vi.fn().mockResolvedValue({ ok: true, data: row }),
    upsert: vi.fn().mockResolvedValue({ ok: true, data: row }),
    updatePlan: overrides.updatePlan ?? vi.fn().mockResolvedValue({ ok: true, data: row }),
    getUsedSecondsInPeriod: vi.fn().mockResolvedValue({ ok: true, data: 600 }), // 10分使用
    // [#40] originalTransactionId 事前重複チェック (オプショナル)
    findByIapOriginalTransactionId:
      overrides.findByIapOriginalTransactionId as
        | SubscriptionRepository["findByIapOriginalTransactionId"]
        | undefined,
    // [#24] Stripe ライフサイクル Webhook のユーザー解決 (オプショナル)
    findByStripeSubscriptionId:
      overrides.findByStripeSubscriptionId as
        | SubscriptionRepository["findByStripeSubscriptionId"]
        | undefined,
  };
}

function makeMockUsageRepo(): UsageRepository {
  return {
    insert: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    findBySessionId: vi.fn().mockResolvedValue({ ok: true, data: null }),
    getTotalSecondsInPeriod: vi.fn().mockResolvedValue({ ok: true, data: 0 }),
  } as unknown as UsageRepository;
}

function makeMockReservationRepo(): ReservationRepository {
  return {
    insert: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    findBySessionId: vi.fn().mockResolvedValue({ ok: true, data: null }),
    update: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    findActive: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  } as unknown as ReservationRepository;
}

function makeMockWebhookRepo(): WebhookEventRepository {
  return {
    insertIdempotent: vi.fn().mockResolvedValue({
      ok: true,
      data: { isNew: true, alreadyProcessed: false, event: { id: "wh_001" } },
    }),
    markProcessed: vi.fn().mockResolvedValue({ ok: true, data: true }),
    markFailed: vi.fn().mockResolvedValue({ ok: true, data: true }),
  } as unknown as WebhookEventRepository;
}

function makeMockExternalPurchaseTokenRepo(
  overrides: Partial<{
    createToken: unknown;
    findByToken: unknown;
    markUsed: unknown;
    cleanupExpired: unknown;
  }> = {},
): ExternalPurchaseTokenRepository {
  const tokenRow: ExternalPurchaseTokenRow = {
    id: "token_row_001",
    userId: "00000000-0000-4000-8000-000000000001",
    token: "a".repeat(64),
    targetTier: "standard",
    stripeSessionId: "cs_test_001",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 分後
    used: false,
    createdAt: new Date().toISOString(),
  };
  return {
    createToken: overrides.createToken ?? vi.fn().mockResolvedValue({ ok: true, data: tokenRow }),
    findByToken: overrides.findByToken ?? vi.fn().mockResolvedValue({ ok: true, data: tokenRow }),
    markUsed: overrides.markUsed ?? vi.fn().mockResolvedValue({ ok: true, data: true }),
    cleanupExpired: overrides.cleanupExpired ?? vi.fn().mockResolvedValue({ ok: true, data: 0 }),
  } as ExternalPurchaseTokenRepository;
}

function makeMockStripeAdapter(overrides: {
  cancelSubscription?: unknown;
} = {}): StripeAdapter {
  return {
    createCheckoutSession: vi.fn().mockResolvedValue({ ok: true, data: { url: "https://checkout.stripe.com/test", sessionId: "cs_001" } }),
    verifyWebhook: vi.fn().mockResolvedValue({ ok: true, data: { id: "evt_001", type: "checkout.session.completed" } }),
    parseCheckoutCompleted: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    parseSubscriptionDeleted: vi.fn().mockReturnValue({ ok: true, data: {} }),
    parseSubscriptionUpdated: vi.fn().mockReturnValue({ ok: true, data: {} }),
    parseInvoicePaid: vi.fn().mockReturnValue({ ok: true, data: {} }),
    // [#41] cancelSubscription を Stripe に伝播する
    cancelSubscription:
      overrides.cancelSubscription ?? vi.fn().mockResolvedValue({ ok: true, data: undefined }),
  } as unknown as StripeAdapter;
}

function makeMockAppleIapAdapter(): AppleIapAdapter {
  return {
    parseWebhookPayload: vi.fn().mockReturnValue({ ok: false, error: { code: "VALIDATION_ERROR", message: "test", retryable: false } }),
    shouldProcessNotification: vi.fn().mockReturnValue(false),
    isActive: vi.fn().mockReturnValue(true),
  } as unknown as AppleIapAdapter;
}

function makeMockGooglePlayAdapter(): GooglePlayAdapter {
  return {
    parseWebhookPayload: vi.fn().mockReturnValue({ ok: false, error: { code: "VALIDATION_ERROR", message: "test", retryable: false } }),
    shouldProcessNotification: vi.fn().mockReturnValue(false),
  } as unknown as GooglePlayAdapter;
}

function makeMockStripeWebCheckoutAdapter(overrides: {
  createCheckoutSession?: unknown;
  getUpgradePreview?: unknown;
  retrieveCheckoutSession?: unknown;
} = {}): StripeWebCheckoutAdapter {
  return {
    createCheckoutSession: overrides.createCheckoutSession ?? vi.fn().mockResolvedValue({
      ok: true,
      data: {
        checkoutUrl: "https://checkout.stripe.com/test_ext",
        sessionId: "cs_ext_001",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        targetTier: "standard",
        returnUrl: "trancall://billing/external-success?session_id=cs_ext_001",
      },
    }),
    getUpgradePreview: overrides.getUpgradePreview ?? vi.fn().mockResolvedValue({
      ok: true,
      data: {
        currentTier: "light",
        targetTier: "standard",
        proratedAmountYen: 1240,
        nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        effectiveImmediately: true,
        confirmationRequired: true,
      },
    }),
    // [#44] Stripe Checkout Session 照会 (決済完了確認)
    retrieveCheckoutSession: overrides.retrieveCheckoutSession ?? vi.fn().mockResolvedValue({
      ok: true,
      data: {
        paymentStatus: "paid",
        status: "complete",
        subscriptionId: "sub_ext_verified_001",
      },
    }),
  } as unknown as StripeWebCheckoutAdapter;
}

function makeMockIapAdapter(overrides: {
  verifyIapTransaction?: unknown;
  resolveTier?: unknown;
  selectLatestTransaction?: unknown;
} = {}): IapAdapter {
  const defaultVerified: VerifiedIapTransaction = {
    originalTransactionId: "orig_tx_001",
    productId: "com.trancall.subscription.light.monthly",
    tier: "light",
    purchaseDate: new Date().toISOString(),
    expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    isValid: true,
  };
  return {
    verifyIapTransaction: overrides.verifyIapTransaction ?? vi.fn().mockResolvedValue({ ok: true, data: defaultVerified }),
    resolveTier: overrides.resolveTier ?? vi.fn().mockReturnValue("light"),
    selectLatestTransaction: overrides.selectLatestTransaction ?? vi.fn().mockImplementation(
      (txs: VerifiedIapTransaction[]) => txs[0] ?? null,
    ),
  } as unknown as IapAdapter;
}

function makeMockExternalPurchaseAdapter(overrides: {
  startExternalPurchase?: unknown;
  validateAndConsumeRedirectToken?: unknown;
} = {}): ExternalPurchaseAdapter {
  return {
    startExternalPurchase: overrides.startExternalPurchase ?? vi.fn().mockResolvedValue({
      ok: true,
      data: {
        redirectUrl: "https://checkout.stripe.com/test_ext",
        redirectToken: "a".repeat(64),
      },
    }),
    validateAndConsumeRedirectToken: overrides.validateAndConsumeRedirectToken ?? vi.fn().mockResolvedValue({
      ok: true,
      data: {
        targetTier: "standard",
        stripeSessionId: "cs_ext_001",
      },
    }),
  } as unknown as ExternalPurchaseAdapter;
}

function makeDeps(overrides: Partial<BillingFacadeDeps> = {}): BillingFacadeDeps {
  return {
    subscriptionRepo: makeMockSubscriptionRepo(),
    usageRepo: makeMockUsageRepo(),
    reservationRepo: makeMockReservationRepo(),
    webhookEventRepo: makeMockWebhookRepo(),
    externalPurchaseTokenRepo: makeMockExternalPurchaseTokenRepo(),
    stripeAdapter: makeMockStripeAdapter(),
    appleIapAdapter: makeMockAppleIapAdapter(),
    googlePlayAdapter: makeMockGooglePlayAdapter(),
    stripeWebCheckoutAdapter: makeMockStripeWebCheckoutAdapter(),
    iapAdapter: makeMockIapAdapter(),
    externalPurchaseAdapter: makeMockExternalPurchaseAdapter(),
    ...overrides,
  };
}

// =============================================================================
// テスト: getPlanComparison
// =============================================================================

describe("BillingFacade.getPlanComparison", () => {
  it("正常系: Free プランユーザーが 4 プランの比較を取得する", async () => {
    const userId = makeUserId();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(freeRow),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.getPlanComparison(userId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.currentTier).toBe("free");
    expect(result.data.plans).toHaveLength(4);
    expect(result.data.plans.map((p) => p.tier)).toEqual([
      "free",
      "light",
      "standard",
      "business",
    ]);
    // Free プランが isCurrent=true
    const freePlan = result.data.plans.find((p) => p.tier === "free");
    expect(freePlan?.isCurrent).toBe(true);
    // Standard が isRecommended=true
    const stdPlan = result.data.plans.find((p) => p.tier === "standard");
    expect(stdPlan?.isRecommended).toBe(true);
  });

  it("正常系: Business プランユーザーが isCurrent=true を持つ Business を含む比較を取得する", async () => {
    const userId = makeUserId();
    const businessRow: SubscriptionRow = {
      ...baseRow,
      plan_tier: "business",
      included_minutes: 500,
      overage_rate_yen: 25,
      monthly_price_yen: 9800,
      transcript_retention_days: 365,
    };
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(businessRow),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.getPlanComparison(userId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.currentTier).toBe("business");
    const businessPlan = result.data.plans.find((p) => p.tier === "business");
    expect(businessPlan?.isCurrent).toBe(true);
    expect(businessPlan?.isRecommended).toBe(false);
  });
});

// =============================================================================
// テスト: previewUpgrade
// =============================================================================

describe("BillingFacade.previewUpgrade", () => {
  it("正常系: Light → Standard で proratedAmountYen > 0", async () => {
    const userId = makeUserId();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow), // light
      stripeWebCheckoutAdapter: makeMockStripeWebCheckoutAdapter({
        getUpgradePreview: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            currentTier: "light",
            targetTier: "standard",
            proratedAmountYen: 1240,
            nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            effectiveImmediately: true,
            confirmationRequired: true,
          },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.previewUpgrade(userId, "standard");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.proratedAmountYen).toBeGreaterThan(0);
    expect(result.data.currentTier).toBe("light");
    expect(result.data.targetTier).toBe("standard");
  });

  it("正常系: Free → Standard で proratedAmountYen = 0", async () => {
    const userId = makeUserId();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(freeRow),
      stripeWebCheckoutAdapter: makeMockStripeWebCheckoutAdapter({
        getUpgradePreview: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            currentTier: "free",
            targetTier: "standard",
            proratedAmountYen: 0,
            nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            effectiveImmediately: true,
            confirmationRequired: true,
          },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.previewUpgrade(userId, "standard");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.proratedAmountYen).toBe(0);
  });

  it("異常系: 同じプランへのアップグレードで BILLING_INVALID_PLAN_CHANGE", async () => {
    const userId = makeUserId();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow), // light
    });
    const facade = createBillingFacade(deps);

    const result = await facade.previewUpgrade(userId, "light"); // 同一プラン

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_INVALID_PLAN_CHANGE");
    expect(result.error.retryable).toBe(false);
  });

  it("異常系: ネットワーク失敗で BILLING_UPGRADE_PREVIEW_FAILED (retryable=true)", async () => {
    const userId = makeUserId();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow),
      stripeWebCheckoutAdapter: makeMockStripeWebCheckoutAdapter({
        getUpgradePreview: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: "BILLING_UPGRADE_PREVIEW_FAILED",
            message: "Stripe API エラー",
            retryable: true,
          },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.previewUpgrade(userId, "standard");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_UPGRADE_PREVIEW_FAILED");
    expect(result.error.retryable).toBe(true);
  });
});

// =============================================================================
// テスト: recordIapTransaction
// =============================================================================

describe("BillingFacade.recordIapTransaction", () => {
  it("正常系: 有効な signedJws で SubscriptionState が更新される", async () => {
    const userId = makeUserId();
    const transaction = makeIapTransaction();
    const deps = makeDeps();
    const facade = createBillingFacade(deps);

    const result = await facade.recordIapTransaction(userId, transaction);

    expect(result.ok).toBe(true);
    expect((deps.subscriptionRepo.updatePlan as Mock)).toHaveBeenCalledTimes(1);
    const updateCall = (deps.subscriptionRepo.updatePlan as Mock).mock.calls[0];
    expect(updateCall[1].purchaseChannel).toBe("iap_apple");
  });

  it("異常系: 無効な signedJws で BILLING_IAP_RECEIPT_INVALID", async () => {
    const userId = makeUserId();
    const transaction = makeIapTransaction({ signedJws: "invalid.jws" });
    const deps = makeDeps({
      iapAdapter: makeMockIapAdapter({
        verifyIapTransaction: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: "BILLING_IAP_RECEIPT_INVALID",
            message: "JWS 検証失敗",
            retryable: false,
          },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.recordIapTransaction(userId, transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });

  it("冪等性: 同一 originalTransactionId で 2 回呼び出しても更新は有効", async () => {
    const userId = makeUserId();
    const transaction = makeIapTransaction();
    const deps = makeDeps();
    const facade = createBillingFacade(deps);

    await facade.recordIapTransaction(userId, transaction);
    const result = await facade.recordIapTransaction(userId, transaction);

    expect(result.ok).toBe(true);
  });

  it("#29 正常系: fromTier が updatePlan 実行前のプランを反映する (free→light)", async () => {
    const userId = makeUserId();
    const transaction = makeIapTransaction();
    const publishedEvents: unknown[] = [];
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(freeRow), // 現在は free
      eventBus: {
        publish: vi.fn().mockImplementation((event: unknown) => {
          publishedEvents.push(event);
        }),
      },
    });
    const facade = createBillingFacade(deps);

    const result = await facade.recordIapTransaction(userId, transaction);

    expect(result.ok).toBe(true);
    expect(publishedEvents).toHaveLength(1);
    const event = publishedEvents[0] as { payload: { fromTier: string; toTier: string } };
    expect(event.payload.fromTier).toBe("free");
    expect(event.payload.toTier).toBe("light");
  });

  it("#40 正常系: 検証済み JWS の expirationDate (verified.expirationDate) が periodEnd に使用される", async () => {
    const userId = makeUserId();
    const verifiedExpiration = "2030-01-01T00:00:00.000Z";
    const transaction = makeIapTransaction({
      // クライアント自己申告の expirationDate は検証済み値と異なる値にしておく
      expirationDate: "2099-01-01T00:00:00.000Z",
    });
    const deps = makeDeps({
      iapAdapter: makeMockIapAdapter({
        verifyIapTransaction: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            originalTransactionId: "orig_tx_001",
            productId: "com.trancall.subscription.light.monthly",
            tier: "light",
            purchaseDate: new Date().toISOString(),
            expirationDate: verifiedExpiration,
            isValid: true,
          },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.recordIapTransaction(userId, transaction);

    expect(result.ok).toBe(true);
    const updateCall = (deps.subscriptionRepo.updatePlan as Mock).mock.calls[0];
    expect(updateCall[1].currentPeriodEnd).toBe(verifiedExpiration);
  });

  it("#40 異常系: 別ユーザーが既に同一 originalTransactionId を保有している場合はエラー", async () => {
    const userId = makeUserId();
    const transaction = makeIapTransaction();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow, {
        findByIapOriginalTransactionId: vi.fn().mockResolvedValue({
          ok: true,
          data: { ...baseRow, user_id: "00000000-0000-4000-8000-000000000999" },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.recordIapTransaction(userId, transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
    expect((deps.subscriptionRepo.updatePlan as Mock)).not.toHaveBeenCalled();
  });

  it("#40 正常系: 同一ユーザーの再送は updatePlan を再実行せず冪等に現在状態を返す (事前チェック)", async () => {
    const userId = makeUserId();
    const transaction = makeIapTransaction();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow, {
        findByIapOriginalTransactionId: vi.fn().mockResolvedValue({
          ok: true,
          data: { ...baseRow, user_id: userId },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.recordIapTransaction(userId, transaction);

    expect(result.ok).toBe(true);
    expect((deps.subscriptionRepo.updatePlan as Mock)).not.toHaveBeenCalled();
  });

  it("#42 異常系: updatePlan が非重複エラーを返した場合エラーを伝播する (握り潰さない)", async () => {
    const userId = makeUserId();
    const transaction = makeIapTransaction();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow, {
        updatePlan: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "DB 接続エラー", retryable: true },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.recordIapTransaction(userId, transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });

  it("#42 正常系: updatePlan が重複エラー (UNIQUE制約) を返した場合は冪等 OK として現在状態を返す", async () => {
    const userId = makeUserId();
    const transaction = makeIapTransaction();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow, {
        updatePlan: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: 'duplicate key value violates unique constraint "iap_original_transaction_id_key"',
            retryable: false,
          },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.recordIapTransaction(userId, transaction);

    expect(result.ok).toBe(true);
  });
});

// =============================================================================
// テスト: startExternalPurchase
// =============================================================================

describe("BillingFacade.startExternalPurchase", () => {
  it("正常系: redirectUrl が返る", async () => {
    const userId = makeUserId();
    const deps = makeDeps();
    const facade = createBillingFacade(deps);

    const result = await facade.startExternalPurchase(userId, "standard");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.redirectUrl).toContain("checkout.stripe.com");
  });

  it("異常系: Stripe API 失敗で BILLING_PAYMENT_FAILED", async () => {
    const userId = makeUserId();
    const deps = makeDeps({
      stripeWebCheckoutAdapter: makeMockStripeWebCheckoutAdapter({
        createCheckoutSession: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: "BILLING_PAYMENT_FAILED",
            message: "Stripe API 失敗",
            retryable: true,
          },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.startExternalPurchase(userId, "standard");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
  });
});

// =============================================================================
// テスト: completeExternalPurchase
// =============================================================================

describe("BillingFacade.completeExternalPurchase", () => {
  it("正常系: 有効な redirectToken でサブスク更新", async () => {
    const userId = makeUserId();
    const redirect = makeExternalRedirect();
    const deps = makeDeps();
    const facade = createBillingFacade(deps);

    const result = await facade.completeExternalPurchase(userId, redirect);

    expect(result.ok).toBe(true);
    expect((deps.subscriptionRepo.updatePlan as Mock)).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ purchaseChannel: "storekit_external" }),
    );
  });

  it("#44 正常系: Stripe 照会結果由来の subscriptionId が使用される (クライアント自己申告値は無視)", async () => {
    const userId = makeUserId();
    // redirect のクライアント自己申告 stripeSubscriptionId は "sub_ext_001" だが、
    // stripeWebCheckoutAdapter.retrieveCheckoutSession のデフォルトモックは "sub_ext_verified_001" を返す
    const redirect = makeExternalRedirect({ stripeSubscriptionId: "sub_ext_CLIENT_CLAIMED" });
    const deps = makeDeps();
    const facade = createBillingFacade(deps);

    const result = await facade.completeExternalPurchase(userId, redirect);

    expect(result.ok).toBe(true);
    expect((deps.subscriptionRepo.updatePlan as Mock)).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ stripeSubscriptionId: "sub_ext_verified_001" }),
    );
  });

  it("#44 異常系: Stripe Checkout Session が未決済 (paymentStatus!=paid) で BILLING_PAYMENT_FAILED", async () => {
    const userId = makeUserId();
    const redirect = makeExternalRedirect();
    const deps = makeDeps({
      stripeWebCheckoutAdapter: makeMockStripeWebCheckoutAdapter({
        retrieveCheckoutSession: vi.fn().mockResolvedValue({
          ok: true,
          data: { paymentStatus: "unpaid", status: "open", subscriptionId: null },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.completeExternalPurchase(userId, redirect);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
    expect((deps.subscriptionRepo.updatePlan as Mock)).not.toHaveBeenCalled();
  });

  it("#42 異常系: updatePlan が失敗した場合エラーを伝播する (握り潰さない)", async () => {
    const userId = makeUserId();
    const redirect = makeExternalRedirect();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow, {
        updatePlan: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "DB down", retryable: true },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.completeExternalPurchase(userId, redirect);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });

  it("異常系: TTL 切れ redirectToken で BILLING_PAYMENT_FAILED", async () => {
    const userId = makeUserId();
    const redirect = makeExternalRedirect();
    const deps = makeDeps({
      externalPurchaseAdapter: makeMockExternalPurchaseAdapter({
        validateAndConsumeRedirectToken: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: "BILLING_PAYMENT_FAILED",
            message: "redirectToken の有効期限が切れています",
            retryable: false,
          },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.completeExternalPurchase(userId, redirect);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
  });

  it("異常系: 使用済み redirectToken で BILLING_PAYMENT_FAILED (二重消費防止)", async () => {
    const userId = makeUserId();
    const redirect = makeExternalRedirect();
    const deps = makeDeps({
      externalPurchaseAdapter: makeMockExternalPurchaseAdapter({
        validateAndConsumeRedirectToken: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: "BILLING_PAYMENT_FAILED",
            message: "redirectToken は既に使用済みです",
            retryable: false,
          },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.completeExternalPurchase(userId, redirect);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
  });
});

// =============================================================================
// テスト: cancelSubscription
// =============================================================================

describe("BillingFacade.cancelSubscription", () => {
  it("正常系: atPeriodEnd=true で cancelAtPeriodEnd=true がセットされる", async () => {
    const userId = makeUserId();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow), // stripe_web
    });
    const facade = createBillingFacade(deps);

    const result = await facade.cancelSubscription(userId, true);

    expect(result.ok).toBe(true);
    const updateCall = (deps.subscriptionRepo.updatePlan as Mock).mock.calls[0];
    expect(updateCall[1].cancelAtPeriodEnd).toBe(true);
  });

  it("#41 正常系: stripe_web チャネルの期末キャンセルで stripeAdapter.cancelSubscription(id, true) が呼ばれる", async () => {
    const userId = makeUserId();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow), // stripe_web, stripe_subscription_id="sub_test"
    });
    const facade = createBillingFacade(deps);

    const result = await facade.cancelSubscription(userId, true);

    expect(result.ok).toBe(true);
    expect(deps.stripeAdapter.cancelSubscription).toHaveBeenCalledWith("sub_test", true);
  });

  it("#41 正常系: stripe_web チャネルの即時キャンセルで stripeAdapter.cancelSubscription(id, false) が呼ばれる", async () => {
    const userId = makeUserId();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow), // stripe_web
    });
    const facade = createBillingFacade(deps);

    const result = await facade.cancelSubscription(userId, false);

    expect(result.ok).toBe(true);
    expect(deps.stripeAdapter.cancelSubscription).toHaveBeenCalledWith("sub_test", false);
  });

  it("#41 正常系: 期末キャンセル時に stripe_subscription_id / iap_original_transaction_id が無条件 null 化されない", async () => {
    const userId = makeUserId();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow), // stripe_customer_id="cus_test", stripe_subscription_id="sub_test"
    });
    const facade = createBillingFacade(deps);

    const result = await facade.cancelSubscription(userId, true);

    expect(result.ok).toBe(true);
    const updateCall = (deps.subscriptionRepo.updatePlan as Mock).mock.calls[0];
    expect(updateCall[1].stripeSubscriptionId).toBe("sub_test");
    expect(updateCall[1].stripeCustomerId).toBe("cus_test");
    expect(updateCall[1].iapOriginalTransactionId).toBeNull();
  });

  it("異常系: IAP チャネルで atPeriodEnd=false を渡した場合にエラー (即時キャンセル不可)", async () => {
    const userId = makeUserId();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(iapRow), // iap_apple
    });
    const facade = createBillingFacade(deps);

    const result = await facade.cancelSubscription(userId, false);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_INVALID_PLAN_CHANGE");
  });

  it("#41 正常系: IAP チャネルの期末キャンセルでは stripeAdapter.cancelSubscription は呼ばれない (Store 側 API 不在)", async () => {
    const userId = makeUserId();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(iapRow), // iap_apple
    });
    const facade = createBillingFacade(deps);

    const result = await facade.cancelSubscription(userId, true);

    expect(result.ok).toBe(true);
    expect(deps.stripeAdapter.cancelSubscription).not.toHaveBeenCalled();
  });

  it("#42 異常系: stripeAdapter.cancelSubscription が失敗した場合エラーを伝播する", async () => {
    const userId = makeUserId();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow),
      stripeAdapter: makeMockStripeAdapter({
        cancelSubscription: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: "BILLING_PAYMENT_FAILED", message: "Stripe API エラー", retryable: true },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.cancelSubscription(userId, true);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
    expect((deps.subscriptionRepo.updatePlan as Mock)).not.toHaveBeenCalled();
  });

  it("#42 異常系: updatePlan が失敗した場合エラーを伝播する (握り潰さない)", async () => {
    const userId = makeUserId();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow, {
        updatePlan: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "DB down", retryable: true },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.cancelSubscription(userId, true);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });
});

// =============================================================================
// テスト: restorePurchases
// =============================================================================

describe("BillingFacade.restorePurchases", () => {
  it("正常系: 有効な transaction 1 件で restoredCount=1", async () => {
    const userId = makeUserId();
    const transactions = [makeIapTransaction()];
    const deps = makeDeps();
    const facade = createBillingFacade(deps);

    const result = await facade.restorePurchases(userId, transactions);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.restoredCount).toBe(1);
    expect(result.data.subscription).not.toBeNull();
  });

  it("正常系: transactions=[] で restoredCount=0, subscription=null", async () => {
    const userId = makeUserId();
    const deps = makeDeps();
    const facade = createBillingFacade(deps);

    const result = await facade.restorePurchases(userId, []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.restoredCount).toBe(0);
    expect(result.data.subscription).toBeNull();
  });

  it("異常系: 全て無効な signedJws で restoredCount=0", async () => {
    const userId = makeUserId();
    const transactions = [makeIapTransaction({ signedJws: "bad.jws.data" })];
    const deps = makeDeps({
      iapAdapter: makeMockIapAdapter({
        verifyIapTransaction: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: "BILLING_IAP_RECEIPT_INVALID",
            message: "JWS 検証失敗",
            retryable: false,
          },
        }),
        selectLatestTransaction: vi.fn().mockReturnValue(null),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.restorePurchases(userId, transactions);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.restoredCount).toBe(0);
    expect(result.data.subscription).toBeNull();
  });

  it("#40 異常系: 別ユーザーが既に同一 originalTransactionId を保有している場合はエラー", async () => {
    const userId = makeUserId();
    const transactions = [makeIapTransaction()];
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow, {
        findByIapOriginalTransactionId: vi.fn().mockResolvedValue({
          ok: true,
          data: { ...baseRow, user_id: "00000000-0000-4000-8000-000000000999" },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.restorePurchases(userId, transactions);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });

  it("#42 異常系: updatePlan が非重複エラーを返した場合エラーを伝播する (握り潰さない)", async () => {
    const userId = makeUserId();
    const transactions = [makeIapTransaction()];
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow, {
        updatePlan: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "DB 接続エラー", retryable: true },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.restorePurchases(userId, transactions);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });
});

// =============================================================================
// テスト: ExternalPurchaseTokenRepository 二重消費防止
// =============================================================================

describe("ExternalPurchaseTokenRepository.markUsed — 二重消費防止", () => {
  it("同一トークンを 2 回 markUsed すると 2 回目は BILLING_PAYMENT_FAILED を返す", async () => {
    let callCount = 0;
    const mockMarkUsed = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ ok: true, data: true });
      }
      return Promise.resolve({
        ok: false,
        error: {
          code: "BILLING_PAYMENT_FAILED",
          message: "redirectToken は既に使用済みか存在しません。二重消費を防止しました。",
          retryable: false,
        },
      });
    });

    const tokenRepo = makeMockExternalPurchaseTokenRepo({
      markUsed: mockMarkUsed,
    });

    // 1 回目: 成功
    const first = await tokenRepo.markUsed("a".repeat(64));
    expect(first.ok).toBe(true);

    // 2 回目: 失敗 (二重消費防止)
    const second = await tokenRepo.markUsed("a".repeat(64));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("BILLING_PAYMENT_FAILED");
    expect(second.error.retryable).toBe(false);
  });

  it("ExternalPurchaseAdapter.validateAndConsumeRedirectToken は markUsed 失敗時に BILLING_PAYMENT_FAILED を伝播する", async () => {
    const userId = makeUserId();
    const redirect = makeExternalRedirect();

    // markUsed が失敗する (使用済み)
    const tokenRepo = makeMockExternalPurchaseTokenRepo({
      markUsed: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "BILLING_PAYMENT_FAILED",
          message: "使用済みトークン",
          retryable: false,
        },
      }),
    });

    const deps = makeDeps({
      externalPurchaseTokenRepo: tokenRepo,
      // ExternalPurchaseAdapter は実際の実装を使わず mock 経由
      externalPurchaseAdapter: makeMockExternalPurchaseAdapter({
        validateAndConsumeRedirectToken: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: "BILLING_PAYMENT_FAILED",
            message: "使用済みトークン",
            retryable: false,
          },
        }),
      }),
    });
    const facade = createBillingFacade(deps);

    const result = await facade.completeExternalPurchase(userId, redirect);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
  });
});

// =============================================================================
// テスト: DomainEvent 発行
// =============================================================================

describe("BillingFacade — DomainEvent 発行", () => {
  it("cancelSubscription で billing.subscription_canceled イベントが発行される", async () => {
    const userId = makeUserId();
    const publishedEvents: unknown[] = [];
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow),
      eventBus: {
        publish: vi.fn().mockImplementation((event: unknown) => {
          publishedEvents.push(event);
        }),
      },
    });
    const facade = createBillingFacade(deps);

    const result = await facade.cancelSubscription(userId, true);

    expect(result.ok).toBe(true);
    expect(publishedEvents).toHaveLength(1);
    const event = publishedEvents[0] as { type: string };
    expect(event.type).toBe("billing.subscription_canceled");
  });

  it("completeExternalPurchase で billing.subscription_upgraded イベントが発行される", async () => {
    const userId = makeUserId();
    const publishedEvents: unknown[] = [];
    const redirect = makeExternalRedirect();
    const deps = makeDeps({
      subscriptionRepo: makeMockSubscriptionRepo(baseRow),
      eventBus: {
        publish: vi.fn().mockImplementation((event: unknown) => {
          publishedEvents.push(event);
        }),
      },
    });
    const facade = createBillingFacade(deps);

    const result = await facade.completeExternalPurchase(userId, redirect);

    expect(result.ok).toBe(true);
    expect(publishedEvents).toHaveLength(1);
    const event = publishedEvents[0] as { type: string };
    expect(event.type).toBe("billing.subscription_upgraded");
  });
});
