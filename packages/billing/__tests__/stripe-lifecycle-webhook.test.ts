/**
 * Stripe ライフサイクル Webhook テスト (#24)
 *
 * customer.subscription.updated / customer.subscription.deleted / invoice.paid が
 * markProcessed のみで終わらず、実際に current_period_end 等を継続更新することを検証する。
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

import { createBillingFacade } from "../src/facade.js";
import type { WebhookEventRepository } from "../src/repositories/webhook-event-repository.js";
import type { SubscriptionRepository } from "../src/repositories/subscription-repository.js";
import type { UsageRepository } from "../src/repositories/usage-repository.js";
import type { ReservationRepository } from "../src/repositories/reservation-repository.js";
import type { WebhookEvent, SubscriptionRow } from "../src/schemas.js";
import { createStripeAdapter } from "../src/adapters/stripe-adapter.js";
import { createAppleIapAdapter } from "../src/adapters/apple-iap-adapter.js";
import { createGooglePlayAdapter } from "../src/adapters/google-play-adapter.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- テスト用可変イベントホルダー
let currentStripeEvent: any = null;

// Stripe SDK モック (constructEvent は currentStripeEvent を返す)
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: vi.fn() } },
    webhooks: {
      constructEvent: vi.fn().mockImplementation(() => currentStripeEvent),
    },
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue({
        id: "sub_test",
        current_period_start: 1_700_000_000,
        current_period_end: 1_702_600_000,
      }),
      cancel: vi.fn().mockResolvedValue({ id: "sub_test", status: "canceled" }),
      update: vi.fn().mockResolvedValue({ id: "sub_test" }),
    },
  })),
  errors: {
    StripeCardError: class extends Error { code = "card_declined"; },
    StripeInvalidRequestError: class extends Error {},
    StripeAPIError: class extends Error {},
  },
}));

const subRow: SubscriptionRow = {
  id: "00000000-0000-4000-8000-000000000010",
  user_id: "00000000-0000-4000-8000-000000000001",
  plan_tier: "standard",
  included_minutes: 120,
  overage_rate_yen: 30,
  monthly_price_yen: 2980,
  transcript_retention_days: 90,
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

function makeWebhookEvent(
  eventType: string,
): { event: WebhookEvent; isNew: boolean; alreadyProcessed: boolean } {
  return {
    isNew: true,
    alreadyProcessed: false,
    event: {
      id: "00000000-0000-4000-8000-000000000099",
      provider: "stripe",
      externalEventId: "evt_test_001",
      eventType,
      payload: {},
      processedAt: null,
      processingError: null,
      receivedAt: "2026-05-10T10:00:00.000Z",
    },
  };
}

function makeDeps(overrides: { findByStripeSubscriptionId?: unknown } = {}) {
  const findByStripeSubscriptionId = Object.prototype.hasOwnProperty.call(
    overrides,
    "findByStripeSubscriptionId",
  )
    ? (overrides.findByStripeSubscriptionId as SubscriptionRepository["findByStripeSubscriptionId"])
    : vi.fn().mockResolvedValue({ ok: true, data: subRow });

  const subscriptionRepo: SubscriptionRepository = {
    findByUserId: vi.fn().mockResolvedValue({ ok: true, data: subRow }),
    upsert: vi.fn().mockResolvedValue({ ok: true, data: subRow }),
    updatePlan: vi.fn().mockResolvedValue({ ok: true, data: subRow }),
    getUsedSecondsInPeriod: vi.fn().mockResolvedValue({ ok: true, data: 0 }),
    findByStripeSubscriptionId,
  };

  const usageRepo: UsageRepository = {
    insertWindowIdempotent: vi.fn(),
    findBySessionId: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    sumDurationSecondsInPeriod: vi.fn().mockResolvedValue({ ok: true, data: 0 }),
  } as unknown as UsageRepository;

  const reservationRepo: ReservationRepository = {
    create: vi.fn(),
    findActiveBySessionId: vi.fn().mockResolvedValue({ ok: true, data: null }),
    reconcile: vi.fn(),
    expire: vi.fn(),
  } as unknown as ReservationRepository;

  const webhookEventRepo: WebhookEventRepository = {
    insertIdempotent: vi.fn().mockResolvedValue({ ok: true, data: makeWebhookEvent(currentStripeEvent?.type ?? "") }),
    markProcessed: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
    markFailed: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
  };

  const stripeAdapter = createStripeAdapter({
    secretKey: "sk_test_dummy",
    webhookSecret: "whsec_dummy",
    priceIds: { light: "price_light", standard: "price_standard", business: "price_business" },
    successUrl: "https://trancall.app/success",
    cancelUrl: "https://trancall.app/cancel",
  });

  return {
    subscriptionRepo,
    usageRepo,
    reservationRepo,
    webhookEventRepo,
    stripeAdapter,
    appleIapAdapter: createAppleIapAdapter(),
    googlePlayAdapter: createGooglePlayAdapter(),
  };
}

beforeEach(() => {
  currentStripeEvent = null;
});

describe("BillingFacade.handleStripeWebhook — customer.subscription.updated (#24)", () => {
  it("current_period_end / cancelAtPeriodEnd を実値で継続更新する", async () => {
    currentStripeEvent = {
      type: "customer.subscription.updated",
      id: "evt_test_001",
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

    const deps = makeDeps();
    const facade = createBillingFacade(deps);

    const result = await facade.handleStripeWebhook("rawbody", "sig");

    expect(result.ok).toBe(true);
    expect(deps.subscriptionRepo.updatePlan).toHaveBeenCalledTimes(1);
    const updateCall = (deps.subscriptionRepo.updatePlan as Mock).mock.calls[0];
    expect(updateCall[1].currentPeriodEnd).toBe(new Date(1_702_600_000 * 1000).toISOString());
    expect(updateCall[1].cancelAtPeriodEnd).toBe(true);
    expect(deps.webhookEventRepo.markProcessed).toHaveBeenCalledOnce();
  });

  it("findByStripeSubscriptionId が未実装 (undefined) の場合はスキップし markProcessed する", async () => {
    currentStripeEvent = {
      type: "customer.subscription.updated",
      id: "evt_test_001",
      data: {
        object: {
          id: "sub_test",
          customer: "cus_test",
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_600_000,
          cancel_at_period_end: false,
        },
      },
    };

    const deps = makeDeps({ findByStripeSubscriptionId: undefined });
    const facade = createBillingFacade(deps);

    const result = await facade.handleStripeWebhook("rawbody", "sig");

    expect(result.ok).toBe(true);
    expect(deps.subscriptionRepo.updatePlan).not.toHaveBeenCalled();
    expect(deps.webhookEventRepo.markProcessed).toHaveBeenCalledOnce();
  });
});

describe("BillingFacade.handleStripeWebhook — customer.subscription.deleted (#24)", () => {
  it("該当ユーザーを Free プランに戻す (簡易実装だった箇所の実装)", async () => {
    currentStripeEvent = {
      type: "customer.subscription.deleted",
      id: "evt_test_001",
      data: {
        object: {
          id: "sub_test",
          customer: "cus_test",
        },
      },
    };

    const deps = makeDeps();
    const facade = createBillingFacade(deps);

    const result = await facade.handleStripeWebhook("rawbody", "sig");

    expect(result.ok).toBe(true);
    expect(deps.subscriptionRepo.updatePlan).toHaveBeenCalledTimes(1);
    const updateCall = (deps.subscriptionRepo.updatePlan as Mock).mock.calls[0];
    expect(updateCall[1].planTier).toBe("free");
    expect(updateCall[1].purchaseChannel).toBe("free");
    expect(updateCall[1].stripeSubscriptionId).toBeNull();
  });
});

describe("BillingFacade.handleStripeWebhook — invoice.paid (#24)", () => {
  it("current_period_end を延長更新する", async () => {
    currentStripeEvent = {
      type: "invoice.paid",
      id: "evt_test_001",
      data: {
        object: {
          customer: "cus_test",
          subscription: "sub_test",
          period_end: 1_702_600_000,
        },
      },
    };

    const deps = makeDeps();
    const facade = createBillingFacade(deps);

    const result = await facade.handleStripeWebhook("rawbody", "sig");

    expect(result.ok).toBe(true);
    expect(deps.subscriptionRepo.updatePlan).toHaveBeenCalledTimes(1);
    const updateCall = (deps.subscriptionRepo.updatePlan as Mock).mock.calls[0];
    expect(updateCall[1].currentPeriodEnd).toBe(new Date(1_702_600_000 * 1000).toISOString());
    // 既存の planTier/purchaseChannel/id はそのまま維持される (無条件 null 化しない)
    expect(updateCall[1].planTier).toBe("standard");
    expect(updateCall[1].stripeSubscriptionId).toBe("sub_test");
  });
});

describe("BillingFacade.handleStripeWebhook — #42 DB 更新失敗時のエラー伝播", () => {
  it("customer.subscription.updated の updatePlan 失敗時は markProcessed せず失敗を伝播する", async () => {
    currentStripeEvent = {
      type: "customer.subscription.updated",
      id: "evt_test_001",
      data: {
        object: {
          id: "sub_test",
          customer: "cus_test",
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_600_000,
          cancel_at_period_end: false,
        },
      },
    };

    const deps = makeDeps();
    (deps.subscriptionRepo.updatePlan as Mock).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "DB down", retryable: true },
    });
    const facade = createBillingFacade(deps);

    const result = await facade.handleStripeWebhook("rawbody", "sig");

    expect(result.ok).toBe(false);
    expect(deps.webhookEventRepo.markProcessed).not.toHaveBeenCalled();
    expect(deps.webhookEventRepo.markFailed).toHaveBeenCalledOnce();
  });
});
