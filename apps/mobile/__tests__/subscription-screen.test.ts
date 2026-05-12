/**
 * subscription-screen.test.ts
 *
 * T-41: settings-subscription-screen の論理テスト
 * (UI レンダリングはテスト環境で困難なため、store との結線・状態遷移ロジックをテスト)
 *
 * docs/billing-ui-flow.md §9.3 状態遷移図 準拠
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mock @trancall/billing
// ============================================================================
vi.mock("@trancall/billing", () => {
  const z = require("zod").z ?? require("zod");
  const PlanTier = z.enum(["free", "light", "standard", "business"]);

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
    SubscriptionState,
    PlanComparisonViewSchema,
    UpgradePreviewSchema,
    CheckoutSessionViewModelSchema,
    IapTransactionResultSchema,
    StoreKitExternalRedirectResultSchema,
    BillingScreenStateSchema,
    BillingErrorViewModelSchema,
    PLAN_CONFIGS: {
      free: { tier: "free", includedMinutes: 5, overageRateYen: 0, monthlyPriceYen: 0, transcriptRetentionDays: 7 },
      light: { tier: "light", includedMinutes: 30, overageRateYen: 40, monthlyPriceYen: 980, transcriptRetentionDays: 30 },
      standard: { tier: "standard", includedMinutes: 120, overageRateYen: 30, monthlyPriceYen: 2980, transcriptRetentionDays: 90 },
      business: { tier: "business", includedMinutes: 500, overageRateYen: 25, monthlyPriceYen: 9800, transcriptRetentionDays: 365 },
    },
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
// Mock auth-store
// ============================================================================
vi.mock("../src/stores/auth-store.js", () => ({
  useAuthStore: {
    getState: vi.fn(() => ({
      session: { accessToken: "mock-access-token" },
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
// ============================================================================

const TEST_USER_ID = UserIdSchema.parse("12345678-1234-4234-b234-123456789012");

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

const standardPlan = {
  tier: "standard" as const,
  includedMinutes: 120,
  overageRateYen: 30,
  monthlyPriceYen: 2980,
  transcriptRetentionDays: 90,
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
  stripeCustomerId: "cus_test",
  stripeSubscriptionId: "sub_test",
  iapOriginalTransactionId: null,
  iapPlatform: null,
};

const standardSubscription = {
  userId: TEST_USER_ID,
  plan: standardPlan,
  usedMinutes: 30,
  remainingMinutes: 90,
  currentPeriodStart: "2026-05-01T00:00:00.000Z",
  currentPeriodEnd: "2026-06-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  stripeCustomerId: "cus_test",
  stripeSubscriptionId: "sub_test",
  iapOriginalTransactionId: null,
  iapPlatform: null,
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
      features: ["30分/月"],
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
      features: ["120分/月"],
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
      features: ["500分/月"],
      isRecommended: false,
      isCurrent: false,
    },
  ],
};

const mockUpgradePreview = {
  currentTier: "free" as const,
  targetTier: "standard" as const,
  proratedAmountYen: 1240,
  nextBillingDate: "2026-06-01T00:00:00.000Z",
  effectiveImmediately: true,
  confirmationRequired: true,
};

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
// Tests — store-level state transitions (subscription screen 論理)
// ============================================================================

describe("Subscription screen store logic", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // 画面マウント時: refresh() が subscription + planComparison を取得
  // docs/billing-ui-flow.md §9.3 loading → showing
  // ==========================================================================

  describe("画面マウント時の refresh()", () => {
    it("subscription と planComparison を同時取得して state に反映する", async () => {
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
      expect(state.planComparison?.plans).toHaveLength(4);
      expect(state.lastError).toBeNull();
    });

    it("API エラー時は lastError がセットされる", async () => {
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
      expect(state.lastError?.code).toBe("NETWORK_ERROR");
    });
  });

  // ==========================================================================
  // アップグレードプレビュー取得
  // docs/billing-ui-flow.md §9.3 showing → confirming
  // ==========================================================================

  describe("loadUpgradePreview()", () => {
    it("日割り計算プレビューを返す", async () => {
      vi.mocked(billingApi.previewUpgrade).mockResolvedValue({
        ok: true,
        data: mockUpgradePreview,
      });

      const preview = await useBillingStore.getState().loadUpgradePreview("standard");

      expect(preview?.targetTier).toBe("standard");
      expect(preview?.proratedAmountYen).toBe(1240);
      expect(preview?.confirmationRequired).toBe(true);
    });

    it("同じプランへのアップグレードで BILLING_INVALID_PLAN_CHANGE を返す", async () => {
      vi.mocked(billingApi.previewUpgrade).mockResolvedValue({
        ok: false,
        error: {
          code: "BILLING_INVALID_PLAN_CHANGE",
          message: "same plan",
          retryable: false,
        },
      });

      const preview = await useBillingStore.getState().loadUpgradePreview("free");

      expect(preview).toBeNull();
      const state = useBillingStore.getState();
      expect(state.lastError?.code).toBe("BILLING_INVALID_PLAN_CHANGE");
      expect(state.lastError?.retryable).toBe(false);
    });

    it("ネットワークエラーで BILLING_UPGRADE_PREVIEW_FAILED を返し retryable=true になる", async () => {
      vi.mocked(billingApi.previewUpgrade).mockResolvedValue({
        ok: false,
        error: {
          code: "BILLING_UPGRADE_PREVIEW_FAILED",
          message: "service unavailable",
          retryable: true,
        },
      });

      await useBillingStore.getState().loadUpgradePreview("standard");

      const state = useBillingStore.getState();
      expect(state.lastError?.code).toBe("BILLING_UPGRADE_PREVIEW_FAILED");
      expect(state.lastError?.retryable).toBe(true);
    });
  });

  // ==========================================================================
  // Stripe Web Checkout 開始 (startExternalPurchase)
  // docs/billing-ui-flow.md §6.3 Step 3 / §8.3 Step 3
  // ==========================================================================

  describe("startExternalPurchase()", () => {
    it("redirectUrl を返し pendingTransaction を storekit_external でセットする", async () => {
      vi.mocked(billingApi.startExternalPurchase).mockResolvedValue({
        ok: true,
        data: { redirectUrl: "https://checkout.stripe.com/pay/cs_test_abc" },
      });

      const result = await useBillingStore.getState().startExternalPurchase("standard");

      expect(result?.redirectUrl).toBe("https://checkout.stripe.com/pay/cs_test_abc");
      // pendingTransaction は startExternalPurchase 成功後も storekit_external のまま
      // (Linking.openURL 後、deep link が来るまで pending のまま)
      expect(useBillingStore.getState().pendingTransaction?.channel).toBe("storekit_external");
    });

    it("失敗時は null を返して lastError をセットし pendingTransaction をクリアする", async () => {
      vi.mocked(billingApi.startExternalPurchase).mockResolvedValue({
        ok: false,
        error: {
          code: "BILLING_PAYMENT_FAILED",
          message: "stripe failed",
          retryable: true,
        },
      });

      const result = await useBillingStore.getState().startExternalPurchase("standard");

      expect(result).toBeNull();
      const state = useBillingStore.getState();
      expect(state.pendingTransaction).toBeNull();
      expect(state.lastError?.code).toBe("BILLING_PAYMENT_FAILED");
      expect(state.lastError?.retryable).toBe(true);
    });
  });

  // ==========================================================================
  // Stripe Success deep link 受信 → onStripeSuccess
  // docs/billing-ui-flow.md §6.3 Step 5
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
        data: standardSubscription,
      });

      await useBillingStore.getState().onStripeSuccess("cs_test_abc");

      const state = useBillingStore.getState();
      expect(state.pendingTransaction).toBeNull();
      expect(state.checkoutSession).toBeNull();
      expect(state.subscriptionState?.plan.tier).toBe("standard");
    });
  });

  // ==========================================================================
  // External Purchase 完了 → onExternalPurchaseSuccess
  // docs/billing-ui-flow.md §8.3 Step 6
  // ==========================================================================

  describe("onExternalPurchaseSuccess()", () => {
    it("complete 成功後に subscription を standard に更新する", async () => {
      vi.mocked(billingApi.completeExternalPurchase).mockResolvedValue({
        ok: true,
        data: standardSubscription,
      });

      await useBillingStore.getState().onExternalPurchaseSuccess({
        redirectToken: "token-xyz",
        stripeSubscriptionId: "sub_abc",
        completedAt: "2026-05-12T00:00:00Z",
      });

      const state = useBillingStore.getState();
      expect(state.subscriptionState?.plan.tier).toBe("standard");
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

      await useBillingStore.getState().onExternalPurchaseSuccess({
        redirectToken: "expired-token",
        stripeSubscriptionId: "sub_abc",
        completedAt: "2026-05-12T00:00:00Z",
      });

      const state = useBillingStore.getState();
      expect(state.lastError?.code).toBe("BILLING_PAYMENT_FAILED");
      expect(state.lastError?.retryable).toBe(false);
    });
  });

  // ==========================================================================
  // Restore Purchases — T-45
  // docs/billing-ui-flow.md §12
  // ==========================================================================

  describe("restorePurchases()", () => {
    it("1件復元成功時に subscription を更新し isRestoring=false になる", async () => {
      vi.mocked(billingApi.restorePurchases).mockResolvedValue({
        ok: true,
        data: { restoredCount: 1, subscription: lightSubscription },
      });

      await useBillingStore.getState().restorePurchases([]);

      const state = useBillingStore.getState();
      expect(state.subscriptionState?.plan.tier).toBe("light");
      expect(state.isRestoring).toBe(false);
      expect(state.lastError).toBeNull();
    });

    it("transactions=[] / restoredCount=0 で BILLING_RESTORE_NO_PURCHASE エラーをセットする", async () => {
      vi.mocked(billingApi.restorePurchases).mockResolvedValue({
        ok: true,
        data: { restoredCount: 0, subscription: null },
      });

      await useBillingStore.getState().restorePurchases([]);

      const state = useBillingStore.getState();
      expect(state.isRestoring).toBe(false);
      expect(state.lastError?.code).toBe("BILLING_RESTORE_NO_PURCHASE");
      expect(state.lastError?.retryable).toBe(false);
    });

    it("API 失敗時に BILLING_IAP_RECEIPT_INVALID をセットする", async () => {
      vi.mocked(billingApi.restorePurchases).mockResolvedValue({
        ok: false,
        error: {
          code: "BILLING_IAP_RECEIPT_INVALID",
          message: "invalid",
          retryable: false,
        },
      });

      await useBillingStore.getState().restorePurchases([]);

      const state = useBillingStore.getState();
      expect(state.isRestoring).toBe(false);
      expect(state.lastError?.code).toBe("BILLING_IAP_RECEIPT_INVALID");
    });

    it("処理中は isRestoring=true になる", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let resolveFn!: (value: any) => void;
      vi.mocked(billingApi.restorePurchases).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => new Promise<any>((resolve) => { resolveFn = resolve; }),
      );

      const promise = useBillingStore.getState().restorePurchases([]);

      expect(useBillingStore.getState().isRestoring).toBe(true);

      resolveFn({ ok: true, data: { restoredCount: 0, subscription: null } });
      await promise;

      expect(useBillingStore.getState().isRestoring).toBe(false);
    });
  });

  // ==========================================================================
  // キャンセル (cancelSubscription)
  // docs/billing-ui-flow.md §5.1
  // ==========================================================================

  describe("cancelSubscription()", () => {
    it("atPeriodEnd=true で cancelAtPeriodEnd=true が DB に反映される", async () => {
      const canceledSub = { ...lightSubscription, cancelAtPeriodEnd: true };
      vi.mocked(billingApi.cancelSubscription).mockResolvedValue({
        ok: true,
        data: canceledSub,
      });

      await useBillingStore.getState().cancelSubscription(true);

      const state = useBillingStore.getState();
      expect(state.subscriptionState?.cancelAtPeriodEnd).toBe(true);
      expect(state.lastError).toBeNull();
    });

    it("IAP チャネルで即時キャンセル (atPeriodEnd=false) が失敗する", async () => {
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
  // エラークリア (clearError)
  // ==========================================================================

  describe("clearError()", () => {
    it("lastError を null にクリアする", () => {
      useBillingStore.setState({
        lastError: {
          code: "NETWORK_ERROR",
          title: "billing.error.NETWORK_ERROR.title",
          message: "billing.error.NETWORK_ERROR.message",
          actionLabel: "billing.error.NETWORK_ERROR.action",
          retryable: true,
        },
      });

      useBillingStore.getState().clearError();

      expect(useBillingStore.getState().lastError).toBeNull();
    });
  });
});
