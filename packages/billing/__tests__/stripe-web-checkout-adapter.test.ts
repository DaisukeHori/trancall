/**
 * StripeWebCheckoutAdapter テスト
 *
 * - createCheckoutSession:
 *   - 正常系 (redirectToken 未指定): 従来通り session_id のみ
 *   - #44 正常系 (redirectToken 指定): success_url / returnUrl に redirect_token が
 *     埋め込まれる (StoreKit External Purchase 完了フローが Stripe 決済検証結果を
 *     クライアントへ受け渡せるようにする修正)
 *   - Free プランエラー
 *   - Price ID 未設定エラー
 * - retrieveCheckoutSession: 正常系 (#44)
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import { createStripeWebCheckoutAdapter } from "../src/adapters/stripe-web-checkout-adapter.js";
import type { StripeWebCheckoutConfig } from "../src/adapters/stripe-web-checkout-adapter.js";

function makeStripeMockImpl(overrides: {
  create?: ReturnType<typeof vi.fn>;
  retrieve?: ReturnType<typeof vi.fn>;
} = {}) {
  return () => ({
    checkout: {
      sessions: {
        create:
          overrides.create ??
          vi.fn().mockResolvedValue({
            id: "cs_test_123",
            url: "https://checkout.stripe.com/pay/cs_test_123",
          }),
        retrieve:
          overrides.retrieve ??
          vi.fn().mockResolvedValue({
            payment_status: "paid",
            status: "complete",
            subscription: "sub_test_123",
          }),
      },
    },
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue({
        id: "sub_test",
        current_period_end: 1_702_600_000,
        items: { data: [{ id: "si_test" }] },
      }),
    },
    invoices: {
      retrieveUpcoming: vi.fn().mockResolvedValue({ amount_due: 1240, currency: "jpy" }),
    },
  });
}

vi.mock("stripe", () => {
  // 実際の "stripe" パッケージは CJS で `module.exports = Stripe; Stripe.errors = {...}`
  // という形 (default エクスポート自体に静的プロパティとして errors が生えている) のため、
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

const config: StripeWebCheckoutConfig = {
  secretKey: "sk_test_dummy",
  webhookSecret: "whsec_dummy",
  priceIds: {
    light: "price_light",
    standard: "price_standard",
    business: "price_business",
  },
  successUrl: "trancall://billing/external-success",
  cancelUrl: "trancall://billing/external-cancel",
};

beforeEach(async () => {
  const Stripe = await import("stripe");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Stripe.default as any).mockImplementation(makeStripeMockImpl());
});

describe("StripeWebCheckoutAdapter.createCheckoutSession", () => {
  it("Free プランはエラーを返す", async () => {
    const adapter = createStripeWebCheckoutAdapter(config);
    const result = await adapter.createCheckoutSession(
      "00000000-0000-4000-8000-000000000001",
      "free",
      "storekit_external",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_INVALID_PLAN_CHANGE");
  });

  it("Price ID 未設定のプランはエラーを返す", async () => {
    const adapter = createStripeWebCheckoutAdapter({
      ...config,
      priceIds: { light: "", standard: "price_standard", business: "price_business" },
    });
    const result = await adapter.createCheckoutSession(
      "00000000-0000-4000-8000-000000000001",
      "light",
      "storekit_external",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("redirectToken 未指定 (従来動作): success_url / returnUrl は session_id のみ含む", async () => {
    const Stripe = await import("stripe");
    const mockCreate = vi.fn().mockResolvedValue({
      id: "cs_test_001",
      url: "https://checkout.stripe.com/pay/cs_test_001",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Stripe.default as any).mockImplementation(makeStripeMockImpl({ create: mockCreate }));

    const adapter = createStripeWebCheckoutAdapter(config);
    const result = await adapter.createCheckoutSession(
      "00000000-0000-4000-8000-000000000001",
      "standard",
      "storekit_external",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.returnUrl).toBe(
      "trancall://billing/external-success?session_id=cs_test_001",
    );
    expect(result.data.returnUrl).not.toContain("redirect_token");

    const createCallArgs = mockCreate.mock.calls[0]?.[0] as { success_url: string };
    expect(createCallArgs.success_url).toBe(
      "trancall://billing/external-success?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(createCallArgs.success_url).not.toContain("redirect_token");
  });

  it("#44 正常系: redirectToken 指定時は success_url / returnUrl に redirect_token として埋め込まれる", async () => {
    const Stripe = await import("stripe");
    const mockCreate = vi.fn().mockResolvedValue({
      id: "cs_ext_001",
      url: "https://checkout.stripe.com/pay/cs_ext_001",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Stripe.default as any).mockImplementation(makeStripeMockImpl({ create: mockCreate }));

    const adapter = createStripeWebCheckoutAdapter(config);
    const redirectToken = "a".repeat(64);

    const result = await adapter.createCheckoutSession(
      "00000000-0000-4000-8000-000000000001",
      "standard",
      "storekit_external",
      undefined,
      redirectToken,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Stripe に渡す success_url に埋め込まれていること (Stripe が {CHECKOUT_SESSION_ID} を実置換する)
    const createCallArgs = mockCreate.mock.calls[0]?.[0] as { success_url: string };
    expect(createCallArgs.success_url).toBe(
      `trancall://billing/external-success?session_id={CHECKOUT_SESSION_ID}&redirect_token=${redirectToken}`,
    );

    // クライアントに返す returnUrl (session.id 置換済み) にも埋め込まれていること
    expect(result.data.returnUrl).toBe(
      `trancall://billing/external-success?session_id=cs_ext_001&redirect_token=${redirectToken}`,
    );
  });
});

describe("StripeWebCheckoutAdapter.retrieveCheckoutSession (#44)", () => {
  it("正常系: paymentStatus/subscriptionId を返す", async () => {
    const adapter = createStripeWebCheckoutAdapter(config);
    const result = await adapter.retrieveCheckoutSession("cs_ext_001");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.paymentStatus).toBe("paid");
    expect(result.data.subscriptionId).toBe("sub_test_123");
  });

  it("異常系: Stripe API 失敗で BILLING_PAYMENT_FAILED", async () => {
    const Stripe = await import("stripe");
    const mockRetrieve = vi.fn().mockRejectedValue(new Error("network error"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Stripe.default as any).mockImplementation(makeStripeMockImpl({ retrieve: mockRetrieve }));

    const adapter = createStripeWebCheckoutAdapter(config);
    const result = await adapter.retrieveCheckoutSession("cs_ext_001");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
  });
});
