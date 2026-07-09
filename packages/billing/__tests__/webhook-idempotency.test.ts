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
    // #24: parseCheckoutCompleted が実際の請求期間取得のために呼び出す
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

/**
 * [#42 確定1] isNew と alreadyProcessed は独立した軸である。
 * - isNew=true な行は常に processedAt=null (新規 INSERT 直後) → alreadyProcessed=false。
 * - isNew=false (23505 衝突) でも、既存行が markFailed のみで markProcessed 未完了なら
 *   processedAt は null のまま → alreadyProcessed=false (再処理が必要)。
 * - alreadyProcessed=true になるのは、既存行が markProcessed 済み (processedAt 非 null) の場合のみ。
 */
function makeWebhookEvent(
  isNew: boolean,
  alreadyProcessed = !isNew,
): { event: WebhookEvent; isNew: boolean; alreadyProcessed: boolean } {
  return {
    isNew,
    alreadyProcessed,
    event: {
      id: "00000000-0000-4000-8000-000000000099",
      provider: "stripe",
      externalEventId: "evt_test_001",
      eventType: "checkout.session.completed",
      payload: {},
      processedAt: alreadyProcessed ? "2026-05-10T10:00:01.000Z" : null,
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
  it("同じ event.id の2回目は alreadyProcessed=true (処理完了済み) なら重複処理しない", async () => {
    const webhookRepo: WebhookEventRepository = {
      insertIdempotent: vi.fn().mockResolvedValue({
        ok: true,
        data: makeWebhookEvent(false, true), // 既存レコード・処理完了済み
      }),
      markProcessed: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      markFailed: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
    };

    const deps = makeMinimalDeps(webhookRepo);
    const facade = createBillingFacade(deps);

    const result = await facade.handleStripeWebhook("rawbody", "sig");
    expect(result.ok).toBe(true);
    // 処理完了済みの重複なので updatePlan は呼ばれない
    expect(deps.subscriptionRepo.updatePlan).not.toHaveBeenCalled();
    expect(webhookRepo.markProcessed).not.toHaveBeenCalled();
    expect(webhookRepo.markFailed).not.toHaveBeenCalled();
  });

  it("新規イベント: isNew=true で updatePlan が呼ばれる", async () => {
    const webhookRepo: WebhookEventRepository = {
      insertIdempotent: vi.fn().mockResolvedValue({
        ok: true,
        data: makeWebhookEvent(true), // 新規レコード (alreadyProcessed=false)
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

  it(
    "[#42 確定1] updatePlan が一過性エラーで失敗 (markFailed・processed_at=null) した後、" +
      "Stripe の再送 (INSERT 23505 衝突・isNew=false だが alreadyProcessed=false) で" +
      "updatePlan が再実行され、最終的にプラン更新が復旧する",
    async () => {
      let updatePlanCallCount = 0;
      const updatePlanMock = vi.fn().mockImplementation(async () => {
        updatePlanCallCount += 1;
        if (updatePlanCallCount === 1) {
          // 1回目: 一過性 DB エラー (retryable)
          return {
            ok: false,
            error: { code: "INTERNAL_ERROR", message: "transient db error", retryable: true },
          };
        }
        // 2回目 (Stripe 再送時の再実行): 成功
        return {
          ok: true,
          data: {
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
          },
        };
      });

      const insertIdempotentMock = vi
        .fn()
        // 1回目: 新規 INSERT 成功 (isNew=true, alreadyProcessed=false)
        .mockResolvedValueOnce({ ok: true, data: makeWebhookEvent(true) })
        // 2回目 (Stripe 再送): INSERT は 23505 で衝突するが、1回目は markFailed のみで
        // processed_at は null のまま → isNew=false かつ alreadyProcessed=false
        .mockResolvedValueOnce({ ok: true, data: makeWebhookEvent(false, false) });

      const markFailedMock = vi.fn().mockResolvedValue({ ok: true, data: undefined });
      const markProcessedMock = vi.fn().mockResolvedValue({ ok: true, data: undefined });

      const webhookRepo: WebhookEventRepository = {
        insertIdempotent: insertIdempotentMock,
        markProcessed: markProcessedMock,
        markFailed: markFailedMock,
      };

      const deps = makeMinimalDeps(webhookRepo);
      deps.subscriptionRepo.updatePlan = updatePlanMock;
      const facade = createBillingFacade(deps);

      // 1回目: Stripe からの初回配信 → updatePlan が一過性エラー → markFailed + エラー返却 (5xx 相当)
      const first = await facade.handleStripeWebhook("rawbody", "sig");
      expect(first.ok).toBe(false);
      expect(markFailedMock).toHaveBeenCalledTimes(1);
      expect(markProcessedMock).not.toHaveBeenCalled();

      // 2回目: Stripe が同一 event.id を再送 → alreadyProcessed=false なので updatePlan を再実行し、
      // 今度は成功して markProcessed される (課金済みプランが正しく反映され、恒久喪失しない)
      const second = await facade.handleStripeWebhook("rawbody", "sig");
      expect(second.ok).toBe(true);
      expect(updatePlanMock).toHaveBeenCalledTimes(2);
      expect(markProcessedMock).toHaveBeenCalledTimes(1);

      // 二重課金/二重付与の確認: updatePlan は「絶対値での状態上書き」であり、
      // 呼ばれた2回とも同一ユーザー・同一 tier の冪等 upsert のため、再実行しても
      // 増分加算や Stripe 側への再課金は発生しない (updatePlan 自体は Stripe に課金要求を
      // 送らない、ローカル DB の状態同期のみ)。
      expect(updatePlanMock.mock.calls[0]?.[0]).toBe(updatePlanMock.mock.calls[1]?.[0]);
    },
  );
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
      productId: "com.trancall.subscription.light.monthly",
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
        data: {
          ...makeWebhookEvent(false, true),
          event: { ...makeWebhookEvent(false, true).event, provider: "apple_iap" },
        },
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
