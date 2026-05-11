/**
 * StripeAdapter テスト
 *
 * - createCheckoutSession: 正常系・Free プランエラー
 * - parseCheckoutCompleted: メタデータパース
 * - verifyWebhook: 署名検証失敗
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import { createStripeAdapter } from "../src/adapters/stripe-adapter.js";
import type { StripeAdapterConfig } from "../src/adapters/stripe-adapter.js";

// Stripe SDK モック
vi.mock("stripe", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      checkout: {
        sessions: {
          create: vi.fn(),
        },
      },
      webhooks: {
        constructEvent: vi.fn(),
      },
    })),
    // Stripe.errors.StripeCardError などのモック
    errors: {
      StripeCardError: class StripeCardError extends Error {
        code = "card_declined";
      },
      StripeInvalidRequestError: class StripeInvalidRequestError extends Error {},
      StripeAPIError: class StripeAPIError extends Error {},
    },
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
    (Stripe.default as any).mockImplementation(() => ({
      checkout: {
        sessions: {
          create: mockCreate,
        },
      },
      webhooks: {
        constructEvent: vi.fn(),
      },
    }));

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Stripe.default as any).mockImplementation(() => ({
      checkout: {
        sessions: {
          create: vi.fn(),
        },
      },
      webhooks: {
        constructEvent: vi.fn().mockImplementation(() => {
          throw new Error("署名が一致しません");
        }),
      },
    }));

    const adapter = createStripeAdapter(config);
    const result = await adapter.verifyWebhook("rawbody", "invalid-sig");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_INVALID_RECEIPT");
  });
});

describe("StripeAdapter.parseCheckoutCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    const result = adapter.parseCheckoutCompleted(mockEvent as any);
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
    const result = adapter.parseCheckoutCompleted(mockEvent as any);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});
