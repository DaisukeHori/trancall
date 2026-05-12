/**
 * pre-call-cost-estimate.test.ts
 *
 * T-17: PreCallCostEstimate を pre-call-screen に表示
 * - computePreCallCostEstimate の 3 状態分岐テスト
 * - 残量 0 時の warn_overage / upgrade テスト
 * - selectPreCallCostEstimate セレクターのテスト
 */

import { describe, it, expect, vi } from "vitest";

// ============================================================================
// Mock @trancall/billing
// billing-store.test.ts と同じモックパターンを使用
// ============================================================================
vi.mock("@trancall/billing", () => {
  const PLAN_CONFIGS = {
    free: {
      tier: "free",
      includedMinutes: 5,
      overageRateYen: 0,
      monthlyPriceYen: 0,
      transcriptRetentionDays: 7,
    },
    light: {
      tier: "light",
      includedMinutes: 30,
      overageRateYen: 40,
      monthlyPriceYen: 980,
      transcriptRetentionDays: 30,
    },
    standard: {
      tier: "standard",
      includedMinutes: 120,
      overageRateYen: 30,
      monthlyPriceYen: 2980,
      transcriptRetentionDays: 90,
    },
    business: {
      tier: "business",
      includedMinutes: 500,
      overageRateYen: 25,
      monthlyPriceYen: 9800,
      transcriptRetentionDays: 365,
    },
  };

  const BillingErrorViewModelSchema = {
    safeParse: (data: unknown) => ({ success: true, data }),
  };

  return {
    PLAN_CONFIGS,
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
// Mock auth-store
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

import {
  computePreCallCostEstimate,
  selectPreCallCostEstimate,
  DEFAULT_EXPECTED_MINUTES,
} from "../src/stores/billing-store.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

type PlanTier = "free" | "light" | "standard" | "business";

const lightPlan = {
  tier: "light" as PlanTier,
  includedMinutes: 30,
  overageRateYen: 40,
  monthlyPriceYen: 980,
  transcriptRetentionDays: 30,
};

const freePlan = {
  tier: "free" as PlanTier,
  includedMinutes: 5,
  overageRateYen: 0,
  monthlyPriceYen: 0,
  transcriptRetentionDays: 7,
};

const standardPlan = {
  tier: "standard" as PlanTier,
  includedMinutes: 120,
  overageRateYen: 30,
  monthlyPriceYen: 2980,
  transcriptRetentionDays: 90,
};

type Plan = typeof lightPlan | typeof freePlan | typeof standardPlan;

// @trancall/billing をモックしているため userId の branded type は不要
// モック内の SubscriptionState は z.string() で userId を定義している
function makeSubscription(plan: Plan, remainingMinutes: number) {
  return {
    userId: "12345678-1234-4234-b234-123456789012",
    plan,
    currentPeriodStart: "2026-05-01T00:00:00.000Z",
    currentPeriodEnd: "2026-06-01T00:00:00.000Z",
    usedMinutes: plan.includedMinutes - remainingMinutes,
    remainingMinutes,
    cancelAtPeriodEnd: false,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    iapOriginalTransactionId: null,
    iapPlatform: null,
  };
}

// ---------------------------------------------------------------------------
// computePreCallCostEstimate — 3 状態のテスト
// ---------------------------------------------------------------------------

describe("computePreCallCostEstimate", () => {
  describe("proceed 状態 (残量十分)", () => {
    it("remainingMinutes > expectedMinutes の場合、proceed を返す", () => {
      const subscription = makeSubscription(lightPlan, 20);
            const result = computePreCallCostEstimate(
        subscription as Parameters<typeof computePreCallCostEstimate>[0],
        15,
      );

      expect(result.recommendedAction).toBe("proceed");
      expect(result.willExceedQuota).toBe(false);
      expect(result.predictedCostYen).toBe(0);
      expect(result.expectedMinutes).toBe(15);
      expect(result.remainingMinutes).toBe(20);
    });

    it("remainingMinutes === expectedMinutes の場合、proceed を返す (境界値)", () => {
      const subscription = makeSubscription(lightPlan, 15);
            const result = computePreCallCostEstimate(
        subscription as Parameters<typeof computePreCallCostEstimate>[0],
        15,
      );

      expect(result.recommendedAction).toBe("proceed");
      expect(result.willExceedQuota).toBe(false);
      expect(result.predictedCostYen).toBe(0);
    });
  });

  describe("warn_overage 状態 (有料プランで超過)", () => {
    it("Light プランで残量不足の場合、warn_overage を返す", () => {
      const subscription = makeSubscription(lightPlan, 12);
            const result = computePreCallCostEstimate(
        subscription as Parameters<typeof computePreCallCostEstimate>[0],
        15,
      );

      expect(result.recommendedAction).toBe("warn_overage");
      expect(result.willExceedQuota).toBe(true);
      // 超過 3 分 × 40 円 = 120 円
      expect(result.predictedCostYen).toBe(120);
      expect(result.expectedMinutes).toBe(15);
      expect(result.remainingMinutes).toBe(12);
    });

    it("Standard プランで超過課金を正しく計算する", () => {
      const subscription = makeSubscription(standardPlan, 10);
            const result = computePreCallCostEstimate(
        subscription as Parameters<typeof computePreCallCostEstimate>[0],
        15,
      );

      expect(result.recommendedAction).toBe("warn_overage");
      expect(result.willExceedQuota).toBe(true);
      // 超過 5 分 × 30 円 = 150 円
      expect(result.predictedCostYen).toBe(150);
    });

    it("残量 0 の Light プランの場合、warn_overage を返す", () => {
      const subscription = makeSubscription(lightPlan, 0);
            const result = computePreCallCostEstimate(
        subscription as Parameters<typeof computePreCallCostEstimate>[0],
        15,
      );

      expect(result.recommendedAction).toBe("warn_overage");
      expect(result.willExceedQuota).toBe(true);
      // 超過 15 分 × 40 円 = 600 円
      expect(result.predictedCostYen).toBe(600);
    });
  });

  describe("upgrade 状態 (Free プランで超過)", () => {
    it("Free プランで残量不足の場合、upgrade を返す", () => {
      const subscription = makeSubscription(freePlan, 3);
            const result = computePreCallCostEstimate(
        subscription as Parameters<typeof computePreCallCostEstimate>[0],
        15,
      );

      expect(result.recommendedAction).toBe("upgrade");
      expect(result.willExceedQuota).toBe(true);
      // Free は overageRateYen=0 なので predictedCostYen=0
      expect(result.predictedCostYen).toBe(0);
    });

    it("残量 0 の Free プランの場合、upgrade を返す", () => {
      const subscription = makeSubscription(freePlan, 0);
            const result = computePreCallCostEstimate(
        subscription as Parameters<typeof computePreCallCostEstimate>[0],
        15,
      );

      expect(result.recommendedAction).toBe("upgrade");
      expect(result.willExceedQuota).toBe(true);
      expect(result.predictedCostYen).toBe(0);
      expect(result.remainingMinutes).toBe(0);
    });
  });

  describe("予測コスト計算の精度", () => {
    it("超過 1 分 × 40 円 = 40 円を正しく計算する", () => {
      const subscription = makeSubscription(lightPlan, 14);
            const result = computePreCallCostEstimate(
        subscription as Parameters<typeof computePreCallCostEstimate>[0],
        15,
      );
      expect(result.predictedCostYen).toBe(40);
    });
  });
});

// ---------------------------------------------------------------------------
// selectPreCallCostEstimate セレクターのテスト
// ---------------------------------------------------------------------------

describe("selectPreCallCostEstimate", () => {
  it("subscriptionState が null の場合、null を返す", () => {
    const state = {
      subscriptionState: null,
      planComparison: null,
      pendingTransaction: null,
      lastError: null,
      isRestoring: false,
      checkoutSession: null,
    };
    const result = selectPreCallCostEstimate(
      state as Parameters<typeof selectPreCallCostEstimate>[0],
    );
    expect(result).toBeNull();
  });

  it("subscriptionState がある場合、DEFAULT_EXPECTED_MINUTES で計算して返す", () => {
    const subscription = makeSubscription(lightPlan, 20);
    const state = {
      subscriptionState: subscription,
      planComparison: null,
      pendingTransaction: null,
      lastError: null,
      isRestoring: false,
      checkoutSession: null,
    };
    const result = selectPreCallCostEstimate(
      state as Parameters<typeof selectPreCallCostEstimate>[0],
    );

    expect(result).not.toBeNull();
    expect(result?.expectedMinutes).toBe(DEFAULT_EXPECTED_MINUTES);
    expect(result?.recommendedAction).toBe("proceed");
  });

  it("DEFAULT_EXPECTED_MINUTES は 15 (Sprint 3 固定値)", () => {
    expect(DEFAULT_EXPECTED_MINUTES).toBe(15);
  });
});
