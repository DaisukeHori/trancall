/**
 * pre-call-history-average.test.ts
 *
 * 2.9 PreCallCost 履歴平均化
 * - computeHistoryAverageMinutes の境界値テスト
 * - selectPreCallCostEstimate が historyAverageMinutes を反映するテスト
 *
 * docs/billing-ui-flow.md §10.1
 */

import { describe, it, expect, vi } from "vitest";

// ============================================================================
// Mock @trancall/billing
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
  computeHistoryAverageMinutes,
  selectPreCallCostEstimate,
  DEFAULT_EXPECTED_MINUTES,
} from "../src/stores/billing-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PlanTier = "free" | "light";

const lightPlan = {
  tier: "light" as PlanTier,
  includedMinutes: 30,
  overageRateYen: 40,
  monthlyPriceYen: 980,
  transcriptRetentionDays: 30,
};

function makeSubscription(remainingMinutes: number) {
  return {
    userId: "12345678-1234-4234-b234-123456789012",
    plan: lightPlan,
    currentPeriodStart: "2026-05-01T00:00:00.000Z",
    currentPeriodEnd: "2026-06-01T00:00:00.000Z",
    usedMinutes: 30 - remainingMinutes,
    remainingMinutes,
    cancelAtPeriodEnd: false,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    iapOriginalTransactionId: null,
    iapPlatform: null,
  };
}

// ---------------------------------------------------------------------------
// computeHistoryAverageMinutes
// ---------------------------------------------------------------------------

describe("computeHistoryAverageMinutes", () => {
  describe("fallback ケース", () => {
    it("空配列は fallback 15 を返す", () => {
      expect(computeHistoryAverageMinutes([])).toBe(DEFAULT_EXPECTED_MINUTES);
    });

    it("1 件の場合は fallback 15 を返す", () => {
      expect(computeHistoryAverageMinutes([600])).toBe(DEFAULT_EXPECTED_MINUTES);
    });

    it("4 件の場合は fallback 15 を返す", () => {
      const durations = [600, 900, 1200, 300];
      expect(computeHistoryAverageMinutes(durations)).toBe(DEFAULT_EXPECTED_MINUTES);
    });

    it("全件 durationSeconds=0 の場合は fallback 15 を返す", () => {
      const zeros = [0, 0, 0, 0, 0];
      expect(computeHistoryAverageMinutes(zeros)).toBe(DEFAULT_EXPECTED_MINUTES);
    });

    it("カスタム fallback 値を使用する", () => {
      expect(computeHistoryAverageMinutes([300], 20)).toBe(20);
    });
  });

  describe("平均算出ケース (5 件以上)", () => {
    it("5 件 × 600 秒 = 10 分を返す", () => {
      const durations = [600, 600, 600, 600, 600];
      expect(computeHistoryAverageMinutes(durations)).toBe(10);
    });

    it("5 件の平均を正しく計算する (端数は丸める)", () => {
      // 300 + 600 + 900 + 1200 + 1500 = 4500 秒 / 5 = 900 秒 = 15 分
      const durations = [300, 600, 900, 1200, 1500];
      expect(computeHistoryAverageMinutes(durations)).toBe(15);
    });

    it("10 件の平均を計算する", () => {
      // 全件 1200 秒 (20 分) なら平均 20 分
      const durations = Array(10).fill(1200) as number[];
      expect(computeHistoryAverageMinutes(durations)).toBe(20);
    });

    it("10 件超の場合は先頭 10 件のみ使用する", () => {
      // 先頭 10 件 × 600 秒 (10 分)、余分の 5 件 × 3600 秒 (60 分) は無視
      const short = Array(10).fill(600) as number[];
      const long = Array(5).fill(3600) as number[];
      const durations = [...short, ...long];
      expect(computeHistoryAverageMinutes(durations)).toBe(10);
    });

    it("1 分未満の平均は最低 1 分を返す", () => {
      // 5 件 × 30 秒 = 150 秒 / 5 = 30 秒 → 0 分 → fallback 1 分
      const durations = [30, 30, 30, 30, 30];
      expect(computeHistoryAverageMinutes(durations)).toBe(1);
    });

    it("6 件の場合も平均算出する", () => {
      // 6 件 × 900 秒 = 5400 / 6 = 900 秒 = 15 分
      const durations = [900, 900, 900, 900, 900, 900];
      expect(computeHistoryAverageMinutes(durations)).toBe(15);
    });
  });
});

// ---------------------------------------------------------------------------
// selectPreCallCostEstimate と historyAverageMinutes の統合
// ---------------------------------------------------------------------------

describe("selectPreCallCostEstimate with historyAverageMinutes", () => {
  it("historyAverageMinutes が指定されると expectedMinutes に使用される", () => {
    const state = {
      subscriptionState: makeSubscription(20),
      planComparison: null,
      pendingTransaction: null,
      lastError: null,
      isRestoring: false,
      checkoutSession: null,
    };
    // 平均 20 分、残量 20 分 → proceed
    const result = selectPreCallCostEstimate(
      state as Parameters<typeof selectPreCallCostEstimate>[0],
      20,
    );
    expect(result).not.toBeNull();
    expect(result?.expectedMinutes).toBe(20);
    expect(result?.recommendedAction).toBe("proceed");
  });

  it("historyAverageMinutes 未指定は DEFAULT_EXPECTED_MINUTES を使用する", () => {
    const state = {
      subscriptionState: makeSubscription(20),
      planComparison: null,
      pendingTransaction: null,
      lastError: null,
      isRestoring: false,
      checkoutSession: null,
    };
    const result = selectPreCallCostEstimate(
      state as Parameters<typeof selectPreCallCostEstimate>[0],
    );
    expect(result?.expectedMinutes).toBe(DEFAULT_EXPECTED_MINUTES);
  });

  it("historyAverageMinutes が残量を超えると warn_overage になる", () => {
    const state = {
      subscriptionState: makeSubscription(10),
      planComparison: null,
      pendingTransaction: null,
      lastError: null,
      isRestoring: false,
      checkoutSession: null,
    };
    // 平均 20 分、残量 10 分 → warn_overage (Light プラン)
    const result = selectPreCallCostEstimate(
      state as Parameters<typeof selectPreCallCostEstimate>[0],
      20,
    );
    expect(result?.recommendedAction).toBe("warn_overage");
    expect(result?.willExceedQuota).toBe(true);
    // 超過 10 分 × 40 円 = 400 円
    expect(result?.predictedCostYen).toBe(400);
  });

  it("subscriptionState が null の場合は null を返す", () => {
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
      20,
    );
    expect(result).toBeNull();
  });
});
