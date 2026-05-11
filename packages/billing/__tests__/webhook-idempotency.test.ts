/**
 * Webhook 冪等性テスト
 *
 * BillingFacade の handleStripeWebhook / handleAppleIapWebhook / handleGoogleIapWebhook が
 * 同じ external_event_id の2回目のリクエストで重複処理しないことを検証する。
 */

import { describe, expect, it, vi } from "vitest";

import {
  brandUserId,
  brandTranslationSessionId,
  brandRoomId,
  type UserId,
  type TranslationSessionId,
} from "@trancall/shared-kernel";

import { createBillingFacade } from "../src/facade.js";
import type { WebhookEventRepository } from "../src/repositories/webhook-event-repository.js";
import type { SubscriptionRepository } from "../src/repositories/subscription-repository.js";
import type { UsageRepository } from "../src/repositories/usage-repository.js";
import type { ReservationRepository } from "../src/repositories/reservation-repository.js";
import type { WebhookEvent } from "../src/schemas.js";
import { createStripeAdapter } from "../src/adapters/stripe-adapter.js";
import { createAppleIapAdapter } from "../src/adapters/apple-iap-adapter.js";
import { createGooglePlayAdapter } from "../src/adapters/google-play-adapter.js";

// Stripe モック
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: vi.fn() } },
    webhooks: {
      constructEvent: vi.fn().mockReturnValue({
        type: "checkout.session.completed",
        id: "evt_test_001",
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
      }),
    },
  })),
  errors: {
    StripeCardError: class extends Error { code = "card_declined"; },
    StripeInvalidRequestError: class extends Error {},
    StripeAPIError: class extends Error {},
  },
}));

function makeWebhookEvent(isNew: boolean): { event: WebhookEvent; isNew: boolean } {
  return {
    isNew,
    event: {
      id: "00000000-0000-4000-8000-000000000099",
      provider: "stripe",
      externalEventId: "evt_test_001",
      eventType: "checkout.session.completed",
      payload: {},
      processedAt: null,
      processingError: null,
      receivedAt: "2026-05-10T10:00:00.000Z",
    },
  };
}

function makeMinimalDeps(webhookRepo: WebhookEventRepository) {
  const subRow = {
    id: "00000000-0000-4000-8000-000000000010",
    user_id: "00000000-0000-4000-8000-000000000001",
    plan_tier: "light" as const,
    included_minutes: 30,
    overage_rate_yen: 40,
    monthly_price_yen: 980,
    transcript_retention_days: 30,
    cancel_at_period_end: false,
    purchase_channel: "stripe_web" as const,
    stripe_customer_id: "cus_test",
    stripe_subscription_id: "sub_test",
    iap_original_transaction_id: null,
    current_period_start: "2026-05-01T00:00:00.000Z",
    current_period_end: "2026-06-01T00:00:00.000Z",
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
  };

  const subscriptionRepo: SubscriptionRepository = {
    findByUserId: vi.fn().mockResolvedValue({ ok: true, data: subRow }),
    upsert: vi.fn().mockResolvedValue({ ok: true, data: subRow }),
    updatePlan: vi.fn().mockResolvedValue({ ok: true, data: subRow }),
    getUsedSecondsInPeriod: vi.fn().mockResolvedValue({ ok: true, data: 0 }),
  };

  const usageRepo: UsageRepository = {
    insertWindowIdempotent: vi.fn(),
    findBySessionId: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    sumDurationSecondsInPeriod: vi.fn().mockResolvedValue({ ok: true, data: 0 }),
  };

  const reservationRepo: ReservationRepository = {
    create: vi.fn(),
    findActiveBySessionId: vi.fn().mockResolvedValue({ ok: true, data: null }),
    reconcile: vi.fn(),
    expire: vi.fn(),
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
    webhookEventRepo: webhookRepo,
    stripeAdapter,
    appleIapAdapter: createAppleIapAdapter(),
    googlePlayAdapter: createGooglePlayAdapter(),
  };
}

// --- テスト ---

describe("BillingFacade.handleStripeWebhook 冪等性", () => {
  it("同じ event.id の2回目は isNew=false で重複処理しない", async () => {
    const webhookRepo: WebhookEventRepository = {
      insertIdempotent: vi.fn().mockResolvedValue({
        ok: true,
        data: makeWebhookEvent(false), // 既存レコード
      }),
      markProcessed: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      markFailed: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
    };

    const deps = makeMinimalDeps(webhookRepo);
    const facade = createBillingFacade(deps);

    const result = await facade.handleStripeWebhook("rawbody", "sig");
    expect(result.ok).toBe(true);
    // 重複処理なので updatePlan は呼ばれない
    expect(deps.subscriptionRepo.updatePlan).not.toHaveBeenCalled();
  });

  it("新規イベント: isNew=true で updatePlan が呼ばれる", async () => {
    const webhookRepo: WebhookEventRepository = {
      insertIdempotent: vi.fn().mockResolvedValue({
        ok: true,
        data: makeWebhookEvent(true), // 新規レコード
      }),
      markProcessed: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      markFailed: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
    };

    const deps = makeMinimalDeps(webhookRepo);
    const facade = createBillingFacade(deps);

    const result = await facade.handleStripeWebhook("rawbody", "sig");
    expect(result.ok).toBe(true);
    expect(deps.subscriptionRepo.updatePlan).toHaveBeenCalledOnce();
    expect(webhookRepo.markProcessed).toHaveBeenCalledOnce();
  });
});

describe("BillingFacade.handleAppleIapWebhook 冪等性", () => {
  it("同じ signedTransactionInfo の2回目は重複処理しない", async () => {
    function buildJws(payload: Record<string, unknown>): string {
      const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url");
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return `${header}.${body}.signature`;
    }

    const signedTransactionInfo = buildJws({
      transactionId: "tx_001",
      originalTransactionId: "orig_001",
      bundleId: "app.trancall",
      productId: "trancall_light_monthly",
      purchaseDate: Date.now(),
      originalPurchaseDate: Date.now(),
    });

    const applePayload = {
      notificationType: "SUBSCRIBED",
      notificationUUID: "uuid-001",
      data: {
        bundleId: "app.trancall",
        environment: "Sandbox" as const,
        signedTransactionInfo,
      },
      version: "2.0",
      signedDate: Date.now(),
    };

    const webhookRepo: WebhookEventRepository = {
      insertIdempotent: vi.fn().mockResolvedValue({
        ok: true,
        data: { ...makeWebhookEvent(false), event: { ...makeWebhookEvent(false).event, provider: "apple_iap" } },
      }),
      markProcessed: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      markFailed: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
    };

    const deps = makeMinimalDeps(webhookRepo);
    const facade = createBillingFacade(deps);

    const result = await facade.handleAppleIapWebhook(applePayload);
    expect(result.ok).toBe(true);
    expect(webhookRepo.markProcessed).not.toHaveBeenCalled(); // 重複なので処理しない
  });
});
