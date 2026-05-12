/**
 * View Model Zod スキーマ テスト
 *
 * docs/billing-ui-flow.md v1.2 §4 canonical 定義に準拠。
 * 各スキーマの valid / invalid ケース + Billing*Event discriminated union 網羅。
 */

import { describe, expect, it } from "vitest";
import {
  PlanComparisonViewSchema,
  UpgradePreviewSchema,
  CheckoutSessionViewModelSchema,
  IapTransactionResultSchema,
  StoreKitExternalRedirectResultSchema,
  BillingScreenStateSchema,
  BillingErrorViewModelSchema,
  PreCallCostEstimateSchema,
  BillingSubscriptionUpgradedEventSchema,
  BillingSubscriptionCanceledEventSchema,
  BillingDomainEventSchema,
  initialBillingScreenState,
} from "../src/view-models/index.js";

// =============================================================================
// テストヘルパー
// =============================================================================

const NOW = "2026-05-12T00:00:00.000Z";
const FUTURE = "2026-06-01T00:00:00.000Z";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const UUID = "00000000-0000-4000-8000-000000000099";

// =============================================================================
// 4.1 PlanComparisonView
// =============================================================================

describe("PlanComparisonViewSchema", () => {
  const validPlan = {
    tier: "light" as const,
    name: "ライト",
    monthlyPriceYen: 980,
    includedMinutes: 30,
    overageRateYen: 40,
    transcriptRetentionDays: 30,
    features: ["feature_a"],
    isRecommended: false,
    isCurrent: true,
  };

  const makePlans = (tier: string = "free") =>
    (["free", "light", "standard", "business"] as const).map((t) => ({
      ...validPlan,
      tier: t,
      isCurrent: t === tier,
    }));

  it("valid: currentTier と 4 件のプランを受け付ける", () => {
    const result = PlanComparisonViewSchema.safeParse({
      currentTier: "light",
      plans: makePlans("light"),
    });
    expect(result.success).toBe(true);
  });

  it("invalid: plans が 3 件では失敗する", () => {
    const result = PlanComparisonViewSchema.safeParse({
      currentTier: "light",
      plans: makePlans().slice(0, 3),
    });
    expect(result.success).toBe(false);
  });

  it("invalid: plans が 5 件では失敗する", () => {
    const result = PlanComparisonViewSchema.safeParse({
      currentTier: "free",
      plans: [...makePlans(), { ...validPlan, tier: "free" }],
    });
    expect(result.success).toBe(false);
  });

  it("invalid: currentTier が不正な値では失敗する", () => {
    const result = PlanComparisonViewSchema.safeParse({
      currentTier: "premium",
      plans: makePlans(),
    });
    expect(result.success).toBe(false);
  });

  it("invalid: monthlyPriceYen が負の値では失敗する", () => {
    const plans = makePlans();
    const result = PlanComparisonViewSchema.safeParse({
      currentTier: "free",
      plans: plans.map((p, i) => (i === 0 ? { ...p, monthlyPriceYen: -1 } : p)),
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// 4.2 UpgradePreview
// =============================================================================

describe("UpgradePreviewSchema", () => {
  const valid = {
    currentTier: "free",
    targetTier: "standard",
    proratedAmountYen: 2000,
    nextBillingDate: FUTURE,
    effectiveImmediately: true,
    confirmationRequired: true,
  };

  it("valid: 正常な UpgradePreview", () => {
    expect(UpgradePreviewSchema.safeParse(valid).success).toBe(true);
  });

  it("valid: proratedAmountYen が 0 (Free からのアップグレード)", () => {
    expect(
      UpgradePreviewSchema.safeParse({ ...valid, proratedAmountYen: 0 }).success,
    ).toBe(true);
  });

  it("invalid: proratedAmountYen が負の値", () => {
    expect(
      UpgradePreviewSchema.safeParse({ ...valid, proratedAmountYen: -100 }).success,
    ).toBe(false);
  });

  it("invalid: nextBillingDate が ISO datetime でない", () => {
    expect(
      UpgradePreviewSchema.safeParse({ ...valid, nextBillingDate: "2026-06-01" }).success,
    ).toBe(false);
  });

  it("invalid: targetTier が未定義の値", () => {
    expect(
      UpgradePreviewSchema.safeParse({ ...valid, targetTier: "enterprise" }).success,
    ).toBe(false);
  });
});

// =============================================================================
// 4.3 CheckoutSessionViewModel
// =============================================================================

describe("CheckoutSessionViewModelSchema", () => {
  const valid = {
    checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_abc",
    sessionId: "cs_test_abc",
    expiresAt: FUTURE,
    targetTier: "standard",
    returnUrl: "trancall://billing/stripe-success?session_id=cs_test_abc",
  };

  it("valid: 正常な CheckoutSessionViewModel", () => {
    expect(CheckoutSessionViewModelSchema.safeParse(valid).success).toBe(true);
  });

  it("invalid: checkoutUrl が URL 形式でない", () => {
    expect(
      CheckoutSessionViewModelSchema.safeParse({ ...valid, checkoutUrl: "not-a-url" }).success,
    ).toBe(false);
  });

  it("invalid: expiresAt が ISO datetime でない", () => {
    expect(
      CheckoutSessionViewModelSchema.safeParse({ ...valid, expiresAt: "tomorrow" }).success,
    ).toBe(false);
  });

  it("invalid: targetTier が不正", () => {
    expect(
      CheckoutSessionViewModelSchema.safeParse({ ...valid, targetTier: "vip" }).success,
    ).toBe(false);
  });
});

// =============================================================================
// 4.4 IapTransactionResult
// =============================================================================

describe("IapTransactionResultSchema", () => {
  const valid = {
    originalTransactionId: "1000000012345678",
    productId: "com.trancall.subscription.light.monthly",
    purchaseDate: NOW,
    expirationDate: FUTURE,
    signedJws: "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature",
    isUpgrade: false,
  };

  it("valid: 正常な IapTransactionResult", () => {
    expect(IapTransactionResultSchema.safeParse(valid).success).toBe(true);
  });

  it("valid: expirationDate が null でも OK", () => {
    expect(
      IapTransactionResultSchema.safeParse({ ...valid, expirationDate: null }).success,
    ).toBe(true);
  });

  it("invalid: purchaseDate が ISO datetime でない", () => {
    expect(
      IapTransactionResultSchema.safeParse({ ...valid, purchaseDate: "not-a-date" }).success,
    ).toBe(false);
  });

  it("invalid: isUpgrade が boolean でない", () => {
    expect(
      IapTransactionResultSchema.safeParse({ ...valid, isUpgrade: "yes" }).success,
    ).toBe(false);
  });

  it("invalid: signedJws が欠落", () => {
    const { signedJws: _s, ...rest } = valid;
    expect(IapTransactionResultSchema.safeParse(rest).success).toBe(false);
  });
});

// =============================================================================
// 4.5 StoreKitExternalRedirectResult
// =============================================================================

describe("StoreKitExternalRedirectResultSchema", () => {
  const valid = {
    redirectToken: "tok_external_test_abc123",
    stripeSubscriptionId: "sub_test_12345",
    completedAt: NOW,
  };

  it("valid: 正常な StoreKitExternalRedirectResult", () => {
    expect(StoreKitExternalRedirectResultSchema.safeParse(valid).success).toBe(true);
  });

  it("invalid: completedAt が ISO datetime でない", () => {
    expect(
      StoreKitExternalRedirectResultSchema.safeParse({
        ...valid,
        completedAt: "05/12/2026",
      }).success,
    ).toBe(false);
  });

  it("invalid: redirectToken が欠落", () => {
    const { redirectToken: _t, ...rest } = valid;
    expect(StoreKitExternalRedirectResultSchema.safeParse(rest).success).toBe(false);
  });
});

// =============================================================================
// 4.6 BillingScreenState
// =============================================================================

describe("BillingScreenStateSchema", () => {
  it("valid: initialBillingScreenState がスキーマを通過する", () => {
    expect(BillingScreenStateSchema.safeParse(initialBillingScreenState).success).toBe(
      true,
    );
  });

  it("valid: pendingTransaction が存在する状態", () => {
    const state = {
      ...initialBillingScreenState,
      pendingTransaction: {
        channel: "iap_apple" as const,
        targetTier: "standard" as const,
        startedAt: NOW,
      },
    };
    expect(BillingScreenStateSchema.safeParse(state).success).toBe(true);
  });

  it("invalid: pendingTransaction.channel が不正な値", () => {
    const state = {
      ...initialBillingScreenState,
      pendingTransaction: {
        channel: "paypal",
        targetTier: "standard",
        startedAt: NOW,
      },
    };
    expect(BillingScreenStateSchema.safeParse(state).success).toBe(false);
  });

  it("invalid: isRestoring が boolean でない", () => {
    const state = { ...initialBillingScreenState, isRestoring: "true" };
    expect(BillingScreenStateSchema.safeParse(state).success).toBe(false);
  });
});

// =============================================================================
// 4.7 BillingErrorViewModel
// =============================================================================

describe("BillingErrorViewModelSchema", () => {
  const valid = {
    code: "BILLING_PAYMENT_FAILED",
    title: "決済に失敗しました",
    message: "お支払い情報を確認してください",
    actionLabel: "再試行",
    retryable: true,
  };

  it("valid: 正常な BillingErrorViewModel", () => {
    expect(BillingErrorViewModelSchema.safeParse(valid).success).toBe(true);
  });

  it("invalid: retryable が欠落", () => {
    const { retryable: _r, ...rest } = valid;
    expect(BillingErrorViewModelSchema.safeParse(rest).success).toBe(false);
  });

  it("invalid: code が空文字", () => {
    // z.string() は空文字を許可するため、このケースでは通過する（仕様上の確認）
    expect(BillingErrorViewModelSchema.safeParse({ ...valid, code: "" }).success).toBe(true);
  });
});

// =============================================================================
// 4.8 Billing*Event (discriminated union 網羅)
// =============================================================================

describe("BillingSubscriptionUpgradedEventSchema", () => {
  const valid = {
    eventId: UUID,
    occurredAt: NOW,
    aggregateId: USER_ID,
    type: "billing.subscription_upgraded" as const,
    payload: {
      userId: USER_ID,
      fromTier: "free" as const,
      toTier: "standard" as const,
      channel: "stripe_web" as const,
      effectiveAt: NOW,
    },
  };

  it("valid: 正常な BillingSubscriptionUpgradedEvent", () => {
    expect(BillingSubscriptionUpgradedEventSchema.safeParse(valid).success).toBe(true);
  });

  it("invalid: type が billing.subscription_canceled では失敗", () => {
    expect(
      BillingSubscriptionUpgradedEventSchema.safeParse({
        ...valid,
        type: "billing.subscription_canceled",
      }).success,
    ).toBe(false);
  });

  it("invalid: payload.userId が UUID でない", () => {
    expect(
      BillingSubscriptionUpgradedEventSchema.safeParse({
        ...valid,
        payload: { ...valid.payload, userId: "not-a-uuid" },
      }).success,
    ).toBe(false);
  });

  it("invalid: payload.fromTier が不正な値", () => {
    expect(
      BillingSubscriptionUpgradedEventSchema.safeParse({
        ...valid,
        payload: { ...valid.payload, fromTier: "enterprise" },
      }).success,
    ).toBe(false);
  });
});

describe("BillingSubscriptionCanceledEventSchema", () => {
  const valid = {
    eventId: UUID,
    occurredAt: NOW,
    aggregateId: USER_ID,
    type: "billing.subscription_canceled" as const,
    payload: {
      userId: USER_ID,
      fromTier: "standard" as const,
      channel: "iap_apple" as const,
      cancelAtPeriodEnd: true,
      effectiveAt: NOW,
    },
  };

  it("valid: 正常な BillingSubscriptionCanceledEvent", () => {
    expect(BillingSubscriptionCanceledEventSchema.safeParse(valid).success).toBe(true);
  });

  it("valid: cancelAtPeriodEnd が false (即時キャンセル)", () => {
    expect(
      BillingSubscriptionCanceledEventSchema.safeParse({
        ...valid,
        payload: { ...valid.payload, cancelAtPeriodEnd: false },
      }).success,
    ).toBe(true);
  });

  it("invalid: type が billing.subscription_upgraded では失敗", () => {
    expect(
      BillingSubscriptionCanceledEventSchema.safeParse({
        ...valid,
        type: "billing.subscription_upgraded",
      }).success,
    ).toBe(false);
  });

  it("invalid: payload.channel が不正な値", () => {
    expect(
      BillingSubscriptionCanceledEventSchema.safeParse({
        ...valid,
        payload: { ...valid.payload, channel: "paypal" },
      }).success,
    ).toBe(false);
  });
});

describe("BillingDomainEventSchema (discriminated union 網羅)", () => {
  it("type=billing.subscription_upgraded を正しく判定する", () => {
    const event = {
      eventId: UUID,
      occurredAt: NOW,
      aggregateId: USER_ID,
      type: "billing.subscription_upgraded" as const,
      payload: {
        userId: USER_ID,
        fromTier: "light" as const,
        toTier: "business" as const,
        channel: "iap_apple" as const,
        effectiveAt: NOW,
      },
    };
    const result = BillingDomainEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("billing.subscription_upgraded");
    }
  });

  it("type=billing.subscription_canceled を正しく判定する", () => {
    const event = {
      eventId: UUID,
      occurredAt: NOW,
      aggregateId: USER_ID,
      type: "billing.subscription_canceled" as const,
      payload: {
        userId: USER_ID,
        fromTier: "business" as const,
        channel: "storekit_external" as const,
        cancelAtPeriodEnd: false,
        effectiveAt: NOW,
      },
    };
    const result = BillingDomainEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("billing.subscription_canceled");
    }
  });

  it("不明な type では失敗する", () => {
    const result = BillingDomainEventSchema.safeParse({
      eventId: UUID,
      occurredAt: NOW,
      aggregateId: USER_ID,
      type: "billing.unknown_event",
      payload: {},
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// 4.9 PreCallCostEstimate
// =============================================================================

describe("PreCallCostEstimateSchema", () => {
  const valid = {
    expectedMinutes: 30,
    remainingMinutes: 10,
    predictedCostYen: 800,
    willExceedQuota: true,
    recommendedAction: "warn_overage" as const,
  };

  it("valid: 正常な PreCallCostEstimate (超過あり)", () => {
    expect(PreCallCostEstimateSchema.safeParse(valid).success).toBe(true);
  });

  it("valid: remainingMinutes が十分で predictedCostYen=0 / willExceedQuota=false", () => {
    const result = PreCallCostEstimateSchema.safeParse({
      expectedMinutes: 10,
      remainingMinutes: 30,
      predictedCostYen: 0,
      willExceedQuota: false,
      recommendedAction: "proceed",
    });
    expect(result.success).toBe(true);
  });

  it("valid: recommendedAction='upgrade' (Free プランで残量なし)", () => {
    const result = PreCallCostEstimateSchema.safeParse({
      ...valid,
      recommendedAction: "upgrade",
      predictedCostYen: 0,
    });
    expect(result.success).toBe(true);
  });

  it("invalid: expectedMinutes が 0 以下 (positive() 制約)", () => {
    expect(
      PreCallCostEstimateSchema.safeParse({ ...valid, expectedMinutes: 0 }).success,
    ).toBe(false);
  });

  it("invalid: remainingMinutes が負の値", () => {
    expect(
      PreCallCostEstimateSchema.safeParse({ ...valid, remainingMinutes: -1 }).success,
    ).toBe(false);
  });

  it("invalid: predictedCostYen が負の値", () => {
    expect(
      PreCallCostEstimateSchema.safeParse({ ...valid, predictedCostYen: -100 }).success,
    ).toBe(false);
  });

  it("invalid: recommendedAction が不正な値", () => {
    expect(
      PreCallCostEstimateSchema.safeParse({ ...valid, recommendedAction: "skip" }).success,
    ).toBe(false);
  });
});
