/**
 * billing-store.test.ts
 *
 * docs/billing-ui-flow.md §14.2 unit テスト詳細 (mobile store) 準拠
 * billingStore の各種 transition (refresh 成功/失敗、各 status のスナップショット)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mock @trancall/billing (view-models / schemas)
// ============================================================================
vi.mock("@trancall/billing", () => {
  const z = require("zod").z ?? require("zod");

  const PlanTier = z.enum(["free", "light", "standard", "business"]);
  const PurchaseChannel = z.enum([
    "free",
    "iap_apple",
    "iap_google",
    "storekit_external",
    "stripe_web",
  ]);

  // 実際の packages/billing/src/schemas.ts の SubscriptionState に合わせる
  const PlanConfig = z.object({
    tier: PlanTier,
    includedMinutes: z.number(),
    overageRateYen: z.number(),
    monthlyPriceYen: z.number(),
    transcriptRetentionDays: z.number(),
  });

  const SubscriptionState = z.object({
    userId: z.string(),
    plan: PlanConfig,
    currentPeriodStart: z.string(),
    currentPeriodEnd: z.string(),
    usedMinutes: z.number(),
    remainingMinutes: z.number(),
    cancelAtPeriodEnd: z.boolean(),
    stripeCustomerId: z.string().nullable(),
    stripeSubscriptionId: z.string().nullable(),
    iapOriginalTransactionId: z.string().nullable(),
    iapPlatform: z.enum(["apple", "google"]).nullable(),
  });

  const PlanComparisonViewSchema = z.object({
    currentTier: PlanTier,
    plans: z.array(
      z.object({
        tier: PlanTier,
        name: z.string(),
        monthlyPriceYen: z.number(),
        includedMinutes: z.number(),
        overageRateYen: z.number(),
        transcriptRetentionDays: z.number(),
        features: z.array(z.string()),
        isRecommended: z.boolean(),
        isCurrent: z.boolean(),
      }),
    ),
  });

  const UpgradePreviewSchema = z.object({
    currentTier: PlanTier,
    targetTier: PlanTier,
    proratedAmountYen: z.number(),
    nextBillingDate: z.string(),
    effectiveImmediately: z.boolean(),
    confirmationRequired: z.boolean(),
  });

  const CheckoutSessionViewModelSchema = z.object({
    checkoutUrl: z.string(),
    sessionId: z.string(),
    expiresAt: z.string(),
    targetTier: PlanTier,
    returnUrl: z.string(),
  });

  const IapTransactionResultSchema = z.object({
    originalTransactionId: z.string(),
    productId: z.string(),
    purchaseDate: z.string(),
    expirationDate: z.string().nullable(),
    signedJws: z.string(),
    isUpgrade: z.boolean(),
  });

  const StoreKitExternalRedirectResultSchema = z.object({
    redirectToken: z.string(),
    stripeSubscriptionId: z.string(),
    completedAt: z.string(),
  });

  const BillingScreenStateSchema = z.object({
    subscriptionState: SubscriptionState.nullable(),
    planComparison: PlanComparisonViewSchema.nullable(),
    pendingTransaction: z
      .object({
        channel: z.enum(["iap_apple", "storekit_external", "stripe_web"]),
        targetTier: PlanTier,
        startedAt: z.string(),
      })
      .nullable(),
    lastError: z
      .object({
        code: z.string(),
        title: z.string(),
        message: z.string(),
        actionLabel: z.string(),
        retryable: z.boolean(),
      })
      .nullable(),
    isRestoring: z.boolean(),
    checkoutSession: CheckoutSessionViewModelSchema.nullable(),
  });

  const BillingErrorViewModelSchema = z.object({
    code: z.string(),
    title: z.string(),
    message: z.string(),
    actionLabel: z.string(),
    retryable: z.boolean(),
  });

  return {
    PlanTier,
    PurchaseChannel,
    SubscriptionState,
    PlanComparisonViewSchema,
    UpgradePreviewSchema,
    CheckoutSessionViewModelSchema,
    IapTransactionResultSchema,
    StoreKitExternalRedirectResultSchema,
    BillingScreenStateSchema,
    BillingErrorViewModelSchema,
    initialBillingScreenState: {
      subscriptionState: null,
      planComparison: null,
      pendingTransaction: null,
      lastError: null,
      isRestoring: false,
      checkoutSession: null,
    },
  };
});

// ============================================================================
// Mock auth-store (session provider)
// ============================================================================
vi.mock("../src/stores/auth-store.js", () => ({
  useAuthStore: {
    getState: vi.fn(() => ({
      session: {
        accessToken: "mock-access-token",
        refreshToken: "mock-refresh-token",
        userId: "mock-user-id",
      },
      profile: null,
    })),
  },
}));

// ============================================================================
// Mock billing-api
// ============================================================================
vi.mock("../src/api/billing-api.js", () => ({
  getSubscription: vi.fn(),
  getPlanComparison: vi.fn(),
  previewUpgrade: vi.fn(),
  recordIapTransaction: vi.fn(),
  restorePurchases: vi.fn(),
  startExternalPurchase: vi.fn(),
  completeExternalPurchase: vi.fn(),
  cancelSubscription: vi.fn(),
}));

// ============================================================================
// Mock API config
// ============================================================================
vi.mock("../src/api/config.js", () => ({
  API_BASE_URL: "http://localhost:3000",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
}));

import * as billingApi from "../src/api/billing-api.js";
import { useBillingStore } from "../src/stores/billing-store.js";
import { UserIdSchema } from "@trancall/shared-kernel";

// ============================================================================
// Test fixtures
// SubscriptionState の実際のスキーマに合わせる (packages/billing/src/schemas.ts)
// { userId, plan: PlanConfig, currentPeriodStart, currentPeriodEnd, usedMinutes,
//   remainingMinutes, cancelAtPeriodEnd, stripeCustomerId, stripeSubscriptionId,
//   iapOriginalTransactionId, iapPlatform }
// ============================================================================

// NOTE: テスト内では @trancall/billing の mock を使っているため、
// mock 内の SubscriptionState 型ではなく実際の型に合わせる。
// vi.mocked の返値型は `any` で受けるため実際には any として扱われる。
// ただし useBillingStore.setState に渡す型は実際の型なので as unknown as ... を使う。

// UUID v4 形式の有効なテスト用 userId
const TEST_USER_ID_RAW = "12345678-1234-4234-b234-123456789012";
// UserIdSchema.parse は境界変換ヘルパーに相当する (CLAUDE.md 型アサーション例外)
const TEST_USER_ID = UserIdSchema.parse(TEST_USER_ID_RAW);

const freePlan = {
  tier: "free" as const,
  includedMinutes: 5,
  overageRateYen: 0,
  monthlyPriceYen: 0,
  transcriptRetentionDays: 7,
};

const lightPlan = {
  tier: "light" as const,
  includedMinutes: 30,
  overageRateYen: 40,
  monthlyPriceYen: 980,
  transcriptRetentionDays: 30,
};

const freeSubscription = {
  userId: TEST_USER_ID,
  plan: freePlan,
  usedMinutes: 2,
  remainingMinutes: 3,
  currentPeriodStart: "2026-05-01T00:00:00.000Z",
  currentPeriodEnd: "2026-06-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  iapOriginalTransactionId: null,
  iapPlatform: null,
};

const lightSubscription = {
  userId: TEST_USER_ID,
  plan: lightPlan,
  usedMinutes: 10,
  remainingMinutes: 20,
  currentPeriodStart: "2026-05-01T00:00:00.000Z",
  currentPeriodEnd: "2026-06-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  iapOriginalTransactionId: "original-txn-001",
  iapPlatform: "apple" as const,
};

const mockPlanComparison = {
  currentTier: "free" as const,
  plans: [
    {
      tier: "free" as const,
      name: "Freeプラン",
      monthlyPriceYen: 0,
      includedMinutes: 5,
      overageRateYen: 0,
      transcriptRetentionDays: 7,
      features: ["5分/月"],
      isRecommended: false,
      isCurrent: true,
    },
    {
      tier: "light" as const,
      name: "Lightプラン",
      monthlyPriceYen: 980,
      includedMinutes: 30,
      overageRateYen: 40,
      transcriptRetentionDays: 30,
      features: ["30分/月", "超過40円/分"],
      isRecommended: false,
      isCurrent: false,
    },
    {
      tier: "standard" as const,
      name: "Standardプラン",
      monthlyPriceYen: 2980,
      includedMinutes: 120,
      overageRateYen: 30,
      transcriptRetentionDays: 90,
      features: ["120分/月", "超過30円/分"],
      isRecommended: true,
      isCurrent: false,
    },
    {
      tier: "business" as const,
      name: "Businessプラン",
      monthlyPriceYen: 9800,
      includedMinutes: 500,
      overageRateYen: 25,
      transcriptRetentionDays: 365,
      features: ["500分/月", "超過25円/分"],
      isRecommended: false,
      isCurrent: false,
    },
  ],
};

const mockUpgradePreview = {
  currentTier: "free" as const,
  targetTier: "standard" as const,
  proratedAmountYen: 0,
  nextBillingDate: "2026-06-01T00:00:00Z",
  effectiveImmediately: true,
  confirmationRequired: true,
};

const mockIapTransaction = {
  originalTransactionId: "original-txn-001",
  productId: "com.trancall.subscription.light.monthly",
  purchaseDate: "2026-05-12T00:00:00Z",
  expirationDate: "2026-06-12T00:00:00Z",
  signedJws: "signed.jws.token",
  isUpgrade: false,
};

const mockRedirectResult = {
  redirectToken: "redirect-token-abc",
  stripeSubscriptionId: "sub_stripe123",
  completedAt: "2026-05-12T00:00:00Z",
};

// ============================================================================
// Helpers
// ============================================================================

function resetStore() {
  useBillingStore.setState({
    subscriptionState: null,
    planComparison: null,
    pendingTransaction: null,
    lastError: null,
    isRestoring: false,
    checkoutSession: null,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("useBillingStore", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // refresh()
  // ==========================================================================

  describe("refresh()", () => {
    it("サブスクリプションとプラン比較を同時に取得して state を更新する", async () => {
      vi.mocked(billingApi.getSubscription).mockResolvedValue({
        ok: true,
        data: freeSubscription,
      });
      vi.mocked(billingApi.getPlanComparison).mockResolvedValue({
        ok: true,
        data: mockPlanComparison,
      });

      await useBillingStore.getState().refresh();

      const state = useBillingStore.getState();
      expect(state.subscriptionState?.plan.tier).toBe("free");
      expect(state.subscriptionState?.remainingMinutes).toBe(3);
      expect(state.planComparison?.plans).toHaveLength(4);
      expect(state.lastError).toBeNull();
    });

    it("subscription 取得失敗時に lastError をセットする", async () => {
      vi.mocked(billingApi.getSubscription).mockResolvedValue({
        ok: false,
        error: { code: "NETWORK_ERROR", message: "network", retryable: true },
      });
      vi.mocked(billingApi.getPlanComparison).mockResolvedValue({
        ok: true,
        data: mockPlanComparison,
      });

      await useBillingStore.getState().refresh();

      const state = useBillingStore.getState();
      expect(state.subscriptionState).toBeNull();
      expect(state.lastError).not.toBeNull();
      expect(state.lastError?.code).toBe("NETWORK_ERROR");
      expect(state.lastError?.retryable).toBe(true);
    });

    it("plan comparison 取得失敗時でも subscription は更新される", async () => {
      vi.mocked(billingApi.getSubscription).mockResolvedValue({
        ok: true,
        data: freeSubscription,
      });
      vi.mocked(billingApi.getPlanComparison).mockResolvedValue({
        ok: false,
        error: { code: "NETWORK_ERROR", message: "network", retryable: true },
      });

      await useBillingStore.getState().refresh();

      const state = useBillingStore.getState();
      expect(state.subscriptionState?.plan.tier).toBe("free");
      expect(state.planComparison).toBeNull();
    });
  });

  // ==========================================================================
  // refreshSubscription()
  // ==========================================================================

  describe("refreshSubscription()", () => {
    it("subscription のみ更新する", async () => {
      vi.mocked(billingApi.getSubscription).mockResolvedValue({
        ok: true,
        data: lightSubscription,
      });

      await useBillingStore.getState().refreshSubscription();

      const state = useBillingStore.getState();
      expect(state.subscriptionState?.plan.tier).toBe("light");
      expect(state.lastError).toBeNull();
    });

    it("失敗時に lastError をセットする", async () => {
      vi.mocked(billingApi.getSubscription).mockResolvedValue({
        ok: false,
        error: {
          code: "BILLING_SUBSCRIPTION_EXPIRED",
          message: "expired",
          retryable: false,
        },
      });

      await useBillingStore.getState().refreshSubscription();

      const state = useBillingStore.getState();
      expect(state.subscriptionState).toBeNull();
      expect(state.lastError?.code).toBe("BILLING_SUBSCRIPTION_EXPIRED");
    });
  });

  // ==========================================================================
  // onIapTransaction()
  // ==========================================================================

  describe("onIapTransaction()", () => {
    it("IAP トランザクション送信成功後に subscription を更新する", async () => {
      vi.mocked(billingApi.recordIapTransaction).mockResolvedValue({
        ok: true,
        data: lightSubscription,
      });

      await useBillingStore.getState().onIapTransaction(mockIapTransaction);

      const state = useBillingStore.getState();
      expect(state.subscriptionState?.plan.tier).toBe("light");
      expect(state.pendingTransaction).toBeNull();
      expect(state.lastError).toBeNull();
    });

    it("送信中は pendingTransaction がセットされる", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let resolveFn!: (value: any) => void;
      vi.mocked(billingApi.recordIapTransaction).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          new Promise<any>((resolve) => {
            resolveFn = resolve;
          }),
      );

      const promise = useBillingStore.getState().onIapTransaction(mockIapTransaction);

      // 送信中の状態を検証
      expect(useBillingStore.getState().pendingTransaction?.channel).toBe(
        "iap_apple",
      );

      // 完了させる
      resolveFn({ ok: true, data: lightSubscription });
      await promise;

      expect(useBillingStore.getState().pendingTransaction).toBeNull();
    });

    it("JWS 検証失敗時に BILLING_IAP_RECEIPT_INVALID エラーをセットする", async () => {
      vi.mocked(billingApi.recordIapTransaction).mockResolvedValue({
        ok: false,
        error: {
          code: "BILLING_IAP_RECEIPT_INVALID",
          message: "invalid jws",
          retryable: false,
        },
      });

      await useBillingStore.getState().onIapTransaction(mockIapTransaction);

      const state = useBillingStore.getState();
      expect(state.pendingTransaction).toBeNull();
      expect(state.lastError?.code).toBe("BILLING_IAP_RECEIPT_INVALID");
      expect(state.lastError?.retryable).toBe(false);
    });
  });

  // ==========================================================================
  // startExternalPurchase()
  // ==========================================================================

  describe("startExternalPurchase()", () => {
    it("redirectUrl を返す", async () => {
      vi.mocked(billingApi.startExternalPurchase).mockResolvedValue({
        ok: true,
        data: { redirectUrl: "https://stripe.example.com/checkout/abc" },
      });

      const result = await useBillingStore
        .getState()
        .startExternalPurchase("standard");

      expect(result?.redirectUrl).toBe(
        "https://stripe.example.com/checkout/abc",
      );
      expect(useBillingStore.getState().pendingTransaction?.channel).toBe(
        "storekit_external",
      );
    });

    it("失敗時に null を返して lastError をセットする", async () => {
      vi.mocked(billingApi.startExternalPurchase).mockResolvedValue({
        ok: false,
        error: {
          code: "BILLING_PAYMENT_FAILED",
          message: "stripe failed",
          retryable: true,
        },
      });

      const result = await useBillingStore
        .getState()
        .startExternalPurchase("standard");

      expect(result).toBeNull();
      const state = useBillingStore.getState();
      expect(state.pendingTransaction).toBeNull();
      expect(state.lastError?.code).toBe("BILLING_PAYMENT_FAILED");
    });
  });

  // ==========================================================================
  // onExternalPurchaseSuccess()
  // ==========================================================================

  describe("onExternalPurchaseSuccess()", () => {
    it("complete 成功後に subscription を更新する", async () => {
      vi.mocked(billingApi.completeExternalPurchase).mockResolvedValue({
        ok: true,
        data: lightSubscription,
      });

      await useBillingStore
        .getState()
        .onExternalPurchaseSuccess(mockRedirectResult);

      const state = useBillingStore.getState();
      expect(state.subscriptionState?.plan.tier).toBe("light");
      expect(state.pendingTransaction).toBeNull();
      expect(state.lastError).toBeNull();
    });

    it("TTL 切れ redirectToken で BILLING_PAYMENT_FAILED をセットする", async () => {
      vi.mocked(billingApi.completeExternalPurchase).mockResolvedValue({
        ok: false,
        error: {
          code: "BILLING_PAYMENT_FAILED",
          message: "ttl expired",
          retryable: false,
        },
      });

      await useBillingStore
        .getState()
        .onExternalPurchaseSuccess(mockRedirectResult);

      const state = useBillingStore.getState();
      expect(state.lastError?.code).toBe("BILLING_PAYMENT_FAILED");
    });
  });

  // ==========================================================================
  // onStripeSuccess()
  // ==========================================================================

  describe("onStripeSuccess()", () => {
    it("pendingTransaction と checkoutSession をクリアして subscription を再取得する", async () => {
      useBillingStore.setState({
        pendingTransaction: {
          channel: "stripe_web",
          targetTier: "standard" as const,
          startedAt: "2026-05-12T00:00:00Z",
        },
        checkoutSession: {
          checkoutUrl: "https://checkout.stripe.com/abc",
          sessionId: "cs_test_abc",
          expiresAt: "2026-05-13T00:00:00Z",
          targetTier: "standard" as const,
          returnUrl: "trancall://billing/stripe-success",
        },
      });

      vi.mocked(billingApi.getSubscription).mockResolvedValue({
        ok: true,
        data: lightSubscription,
      });

      await useBillingStore.getState().onStripeSuccess("cs_test_abc");

      const state = useBillingStore.getState();
      expect(state.pendingTransaction).toBeNull();
      expect(state.checkoutSession).toBeNull();
      expect(state.subscriptionState?.plan.tier).toBe("light");
    });
  });

  // ==========================================================================
  // restorePurchases()
  // ==========================================================================

  describe("restorePurchases()", () => {
    it("復元成功時に subscription を更新する", async () => {
      vi.mocked(billingApi.restorePurchases).mockResolvedValue({
        ok: true,
        data: { restoredCount: 1, subscription: lightSubscription },
      });

      await useBillingStore.getState().restorePurchases([mockIapTransaction]);

      const state = useBillingStore.getState();
      expect(state.subscriptionState?.plan.tier).toBe("light");
      expect(state.isRestoring).toBe(false);
      expect(state.lastError).toBeNull();
    });

    it("restoredCount=0 のとき BILLING_RESTORE_NO_PURCHASE エラーをセットする", async () => {
      vi.mocked(billingApi.restorePurchases).mockResolvedValue({
        ok: true,
        data: { restoredCount: 0, subscription: null },
      });

      await useBillingStore.getState().restorePurchases([]);

      const state = useBillingStore.getState();
      expect(state.isRestoring).toBe(false);
      expect(state.lastError?.code).toBe("BILLING_RESTORE_NO_PURCHASE");
    });

    it("API 失敗時に lastError をセットする", async () => {
      vi.mocked(billingApi.restorePurchases).mockResolvedValue({
        ok: false,
        error: {
          code: "BILLING_IAP_RECEIPT_INVALID",
          message: "invalid",
          retryable: false,
        },
      });

      await useBillingStore.getState().restorePurchases([mockIapTransaction]);

      const state = useBillingStore.getState();
      expect(state.isRestoring).toBe(false);
      expect(state.lastError?.code).toBe("BILLING_IAP_RECEIPT_INVALID");
    });

    it("復元処理中は isRestoring=true になる", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let resolveFn!: (value: any) => void;
      vi.mocked(billingApi.restorePurchases).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          new Promise<any>((resolve) => {
            resolveFn = resolve;
          }),
      );

      const promise = useBillingStore
        .getState()
        .restorePurchases([mockIapTransaction]);

      expect(useBillingStore.getState().isRestoring).toBe(true);

      resolveFn({ ok: true, data: { restoredCount: 1, subscription: lightSubscription } });
      await promise;

      expect(useBillingStore.getState().isRestoring).toBe(false);
    });
  });

  // ==========================================================================
  // cancelSubscription()
  // ==========================================================================

  describe("cancelSubscription()", () => {
    it("atPeriodEnd=true でサブスクリプションをキャンセルする", async () => {
      const canceledSubscription = {
        ...lightSubscription,
        cancelAtPeriodEnd: true,
      };
      vi.mocked(billingApi.cancelSubscription).mockResolvedValue({
        ok: true,
        data: canceledSubscription,
      });

      await useBillingStore.getState().cancelSubscription(true);

      const state = useBillingStore.getState();
      expect(state.subscriptionState?.cancelAtPeriodEnd).toBe(true);
      expect(state.lastError).toBeNull();
    });

    it("キャンセル失敗時に lastError をセットする", async () => {
      vi.mocked(billingApi.cancelSubscription).mockResolvedValue({
        ok: false,
        error: {
          code: "BILLING_CHANNEL_NOT_AVAILABLE",
          message: "iap cannot cancel immediately",
          retryable: false,
        },
      });

      await useBillingStore.getState().cancelSubscription(false);

      const state = useBillingStore.getState();
      expect(state.lastError?.code).toBe("BILLING_CHANNEL_NOT_AVAILABLE");
    });
  });

  // ==========================================================================
  // updateRemainingMinutes()
  // ==========================================================================

  describe("updateRemainingMinutes()", () => {
    it("subscriptionState の remainingMinutes を部分更新する", () => {
      useBillingStore.setState({
        subscriptionState: { ...freeSubscription, remainingMinutes: 5 },
      });

      useBillingStore.getState().updateRemainingMinutes(3);

      const state = useBillingStore.getState();
      expect(state.subscriptionState?.remainingMinutes).toBe(3);
      // 他のフィールドは変化しない
      expect(state.subscriptionState?.plan.tier).toBe("free");
    });

    it("subscriptionState が null のときは何もしない", () => {
      useBillingStore.setState({ subscriptionState: null });

      useBillingStore.getState().updateRemainingMinutes(10);

      expect(useBillingStore.getState().subscriptionState).toBeNull();
    });
  });

  // ==========================================================================
  // clearError()
  // ==========================================================================

  describe("clearError()", () => {
    it("lastError を null にクリアする", () => {
      useBillingStore.setState({
        lastError: {
          code: "NETWORK_ERROR",
          title: "接続できません",
          message: "ネットワークを確認してください。",
          actionLabel: "再試行",
          retryable: true,
        },
      });

      useBillingStore.getState().clearError();

      expect(useBillingStore.getState().lastError).toBeNull();
    });
  });

  // ==========================================================================
  // loadUpgradePreview()
  // ==========================================================================

  describe("loadUpgradePreview()", () => {
    it("アップグレードプレビューを返す", async () => {
      vi.mocked(billingApi.previewUpgrade).mockResolvedValue({
        ok: true,
        data: mockUpgradePreview,
      });

      const preview = await useBillingStore
        .getState()
        .loadUpgradePreview("standard");

      expect(preview?.targetTier).toBe("standard");
      expect(preview?.proratedAmountYen).toBe(0);
    });

    it("BILLING_INVALID_PLAN_CHANGE エラー時に null を返して lastError をセットする", async () => {
      vi.mocked(billingApi.previewUpgrade).mockResolvedValue({
        ok: false,
        error: {
          code: "BILLING_INVALID_PLAN_CHANGE",
          message: "same plan",
          retryable: false,
        },
      });

      const preview = await useBillingStore
        .getState()
        .loadUpgradePreview("free");

      expect(preview).toBeNull();
      const state = useBillingStore.getState();
      expect(state.lastError?.code).toBe("BILLING_INVALID_PLAN_CHANGE");
    });

    it("BILLING_UPGRADE_PREVIEW_FAILED エラー時に retryable=true になる", async () => {
      vi.mocked(billingApi.previewUpgrade).mockResolvedValue({
        ok: false,
        error: {
          code: "BILLING_UPGRADE_PREVIEW_FAILED",
          message: "service unavailable",
          retryable: true,
        },
      });

      await useBillingStore.getState().loadUpgradePreview("standard");

      expect(useBillingStore.getState().lastError?.retryable).toBe(true);
    });
  });

  // ==========================================================================
  // Snapshot: 各 status の初期値
  // ==========================================================================

  describe("初期状態スナップショット", () => {
    it("初期状態は全て null / false / undefined", () => {
      const state = useBillingStore.getState();
      expect(state.subscriptionState).toBeNull();
      expect(state.planComparison).toBeNull();
      expect(state.pendingTransaction).toBeNull();
      expect(state.lastError).toBeNull();
      expect(state.isRestoring).toBe(false);
      expect(state.checkoutSession).toBeNull();
    });
  });
});
