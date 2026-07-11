/**
 * StripeAdapter テスト
 *
 * - createCheckoutSession: 正常系・Free プランエラー
 * - parseCheckoutCompleted: メタデータパース + 実 period 取得 (#24)
 * - verifyWebhook: 署名検証失敗
 * - cancelSubscription: 期末キャンセル / 即時キャンセル (#41)
 * - parseSubscriptionUpdated / parseInvoicePaid: ライフサイクルイベント解析 (#24)
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import { createStripeAdapter } from "../src/adapters/stripe-adapter.js";
import type { StripeAdapterConfig } from "../src/adapters/stripe-adapter.js";

function makeStripeMockImpl(overrides: {
  create?: ReturnType<typeof vi.fn>;
  constructEvent?: ReturnType<typeof vi.fn>;
  retrieve?: ReturnType<typeof vi.fn>;
  cancel?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
} = {}) {
  return () => ({
    checkout: {
      sessions: {
        create: overrides.create ?? vi.fn(),
      },
    },
    webhooks: {
      constructEvent: overrides.constructEvent ?? vi.fn(),
    },
    subscriptions: {
      retrieve:
        overrides.retrieve ??
        vi.fn().mockResolvedValue({
          id: "sub_test",
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_600_000,
        }),
      cancel: overrides.cancel ?? vi.fn().mockResolvedValue({ id: "sub_test", status: "canceled" }),
      update: overrides.update ?? vi.fn().mockResolvedValue({ id: "sub_test" }),
    },
  });
}

// Stripe SDK モック
vi.mock("stripe", () => {
  // 実際の "stripe" パッケージは CJS で `module.exports = Stripe; Stripe.errors = {...}`
  // という形 (default エクスポート自体に静的プロパティとして errors が生えている) のため、
  // `import Stripe from "stripe"; Stripe.errors.X` が動作する。モックでも同様に、
  // default 関数オブジェクト自身に errors を生やす (兄弟の named export にすると
  // default import 経由ではアクセスできない)。
  const errorsNamespace = {
    StripeCardError: class StripeCardError extends Error {
      code = "card_declined";
    },
    StripeInvalidRequestError: class StripeInvalidRequestError extends Error {},
    StripeAPIError: class StripeAPIError extends Error {},
  };
  const StripeMock = vi.fn().mockImplementation(makeStripeMockImpl());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- テストモックのみ許可
  (StripeMock as any).errors = errorsNamespace;
  return {
    default: StripeMock,
    errors: errorsNamespace,
  };
});

const config: StripeAdapterConfig = {
  secretKey: "sk_test_dummy",
  webhookSecret: "whsec_dummy",
  priceIds: {
    light: "price_light",
    standard: "price_standard",
    business: "price_business",
  },
  successUrl: "https://trancall.app/success",
  cancelUrl: "https://trancall.app/cancel",
};

describe("StripeAdapter.createCheckoutSession", () => {
  it("Free プランはエラーを返す", async () => {
    const adapter = createStripeAdapter(config);
    const result = await adapter.createCheckoutSession({
      userId: "00000000-0000-4000-8000-000000000001",
      tier: "free",
      channel: "stripe_web",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("stripe_web チャネルで正常に Checkout URL を返す", async () => {
    const Stripe = await import("stripe");
    const mockCreate = vi.fn().mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/pay/cs_test_123",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Stripe.default as any).mockImplementation(makeStripeMockImpl({ create: mockCreate }));

    const adapter = createStripeAdapter(config);
    const result = await adapter.createCheckoutSession({
      userId: "00000000-0000-4000-8000-000000000001",
      tier: "standard",
      channel: "stripe_web",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.url).toContain("checkout.stripe.com");
  });
});

describe("StripeAdapter.verifyWebhook", () => {
  it("署名検証失敗: BILLING_INVALID_RECEIPT", async () => {
    const Stripe = await import("stripe");
    const constructEvent = vi.fn().mockImplementation(() => {
      throw new Error("署名が一致しません");
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Stripe.default as any).mockImplementation(makeStripeMockImpl({ constructEvent }));

    const adapter = createStripeAdapter(config);
    const result = await adapter.verifyWebhook("rawbody", "invalid-sig");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_INVALID_RECEIPT");
  });
});

describe("StripeAdapter.parseCheckoutCompleted", () => {
  beforeEach(async () => {
    const Stripe = await import("stripe");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Stripe.default as any).mockImplementation(makeStripeMockImpl());
  });

  it("不正なメタデータ: BILLING_INVALID_RECEIPT", async () => {
    const adapter = createStripeAdapter(config);

    const mockEvent = {
      type: "checkout.session.completed",
      id: "evt_test",
      data: {
        object: {
          metadata: {
            // tier が欠けている
            userId: "00000000-0000-4000-8000-000000000001",
            channel: "stripe_web",
          },
          customer: "cus_test",
          subscription: "sub_test",
        },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await adapter.parseCheckoutCompleted(mockEvent as any);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_INVALID_RECEIPT");
  });

  it("想定外のイベントタイプ: VALIDATION_ERROR", async () => {
    const adapter = createStripeAdapter(config);
    const mockEvent = {
      type: "payment_intent.created",
      id: "evt_test",
      data: { object: {} },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await adapter.parseCheckoutCompleted(mockEvent as any);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("正常系: Stripe Subscription API から実際の請求期間を取得する (#24: now+30日暫定値の廃止)", async () => {
    const adapter = createStripeAdapter(config);
    const mockEvent = {
      type: "checkout.session.completed",
      id: "evt_test",
      data: {
        object: {
          metadata: {
            userId: "00000000-0000-4000-8000-000000000001",
            tier: "standard",
            channel: "stripe_web",
          },
          customer: "cus_test",
          subscription: "sub_test",
        },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await adapter.parseCheckoutCompleted(mockEvent as any);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // makeStripeMockImpl のデフォルト retrieve モック値と一致すること (暫定30日値ではない)
    expect(result.data.currentPeriodStart).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(result.data.currentPeriodEnd).toBe(new Date(1_702_600_000 * 1000).toISOString());
  });
});

describe("StripeAdapter.cancelSubscription (#41)", () => {
  beforeEach(async () => {
    const Stripe = await import("stripe");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Stripe.default as any).mockImplementation(makeStripeMockImpl());
  });

  it("atPeriodEnd=true: subscriptions.update({cancel_at_period_end:true}) を呼ぶ", async () => {
    const Stripe = await import("stripe");
    const updateMock = vi.fn().mockResolvedValue({ id: "sub_test" });
    const cancelMock = vi.fn().mockResolvedValue({ id: "sub_test" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Stripe.default as any).mockImplementation(
      makeStripeMockImpl({ update: updateMock, cancel: cancelMock }),
    );

    const adapter = createStripeAdapter(config);
    const result = await adapter.cancelSubscription("sub_test", true);

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith("sub_test", { cancel_at_period_end: true });
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("atPeriodEnd=false: subscriptions.cancel() で即時解約する (update だけでは解約されないバグの修正)", async () => {
    const Stripe = await import("stripe");
    const updateMock = vi.fn().mockResolvedValue({ id: "sub_test" });
    const cancelMock = vi.fn().mockResolvedValue({ id: "sub_test", status: "canceled" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Stripe.default as any).mockImplementation(
      makeStripeMockImpl({ update: updateMock, cancel: cancelMock }),
    );

    const adapter = createStripeAdapter(config);
    const result = await adapter.cancelSubscription("sub_test", false);

    expect(result.ok).toBe(true);
    expect(cancelMock).toHaveBeenCalledWith("sub_test");
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("StripeAdapter.reactivateSubscription (#65)", () => {
  beforeEach(async () => {
    const Stripe = await import("stripe");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Stripe.default as any).mockImplementation(makeStripeMockImpl());
  });

  it("正常系: subscriptions.update({cancel_at_period_end:false}) を呼ぶ (cancelSubscription の対称操作)", async () => {
    const Stripe = await import("stripe");
    const updateMock = vi.fn().mockResolvedValue({ id: "sub_test" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Stripe.default as any).mockImplementation(makeStripeMockImpl({ update: updateMock }));

    const adapter = createStripeAdapter(config);
    const result = await adapter.reactivateSubscription("sub_test");

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith("sub_test", { cancel_at_period_end: false });
  });

  it("異常系: Stripe API 失敗時はエラーを返す", async () => {
    const Stripe = await import("stripe");
    const updateMock = vi.fn().mockRejectedValue(new Error("network error"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Stripe.default as any).mockImplementation(makeStripeMockImpl({ update: updateMock }));

    const adapter = createStripeAdapter(config);
    const result = await adapter.reactivateSubscription("sub_test");

    expect(result.ok).toBe(false);
  });
});

describe("StripeAdapter.parseSubscriptionUpdated (#24)", () => {
  it("正常系: current_period_end 等を抽出する", () => {
    const adapter = createStripeAdapter(config);
    const mockEvent = {
      type: "customer.subscription.updated",
      id: "evt_test",
      data: {
        object: {
          id: "sub_test",
          customer: "cus_test",
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_600_000,
          cancel_at_period_end: true,
        },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = adapter.parseSubscriptionUpdated(mockEvent as any);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.stripeSubscriptionId).toBe("sub_test");
    expect(result.data.cancelAtPeriodEnd).toBe(true);
    expect(result.data.currentPeriodEnd).toBe(new Date(1_702_600_000 * 1000).toISOString());
  });

  it("想定外のイベントタイプ: VALIDATION_ERROR", () => {
    const adapter = createStripeAdapter(config);
    const mockEvent = { type: "payment_intent.created", id: "evt_test", data: { object: {} } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = adapter.parseSubscriptionUpdated(mockEvent as any);
    expect(result.ok).toBe(false);
  });
});

describe("StripeAdapter.parseInvoicePaid (#24)", () => {
  it("正常系: current_period_end を抽出する", () => {
    const adapter = createStripeAdapter(config);
    const mockEvent = {
      type: "invoice.paid",
      id: "evt_test",
      data: {
        object: {
          customer: "cus_test",
          subscription: "sub_test",
          period_end: 1_702_600_000,
        },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = adapter.parseInvoicePaid(mockEvent as any);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.stripeSubscriptionId).toBe("sub_test");
    expect(result.data.currentPeriodEnd).toBe(new Date(1_702_600_000 * 1000).toISOString());
  });

  it("想定外のイベントタイプ: VALIDATION_ERROR", () => {
    const adapter = createStripeAdapter(config);
    const mockEvent = { type: "payment_intent.created", id: "evt_test", data: { object: {} } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = adapter.parseInvoicePaid(mockEvent as any);
    expect(result.ok).toBe(false);
  });
});
