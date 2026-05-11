/**
 * SubscriptionService テスト
 *
 * - getSubscription: usedMinutes / remainingMinutes の計算
 * - canStartCall: 残量チェック
 */

import { describe, expect, it, vi } from "vitest";

import {
  brandUserId,
  type UserId,
} from "@trancall/shared-kernel";

import { createSubscriptionService } from "../src/services/subscription-service.js";
import type { SubscriptionRepository } from "../src/repositories/subscription-repository.js";
import type { SubscriptionRow } from "../src/schemas.js";

// --- ヘルパー ---

function makeUserId(): UserId {
  const r = brandUserId("00000000-0000-4000-8000-000000000001");
  if (!r.success) throw new Error("test setup: brandUserId failed");
  return r.data;
}

const baseRow: SubscriptionRow = {
  id: "00000000-0000-4000-8000-000000000010",
  user_id: "00000000-0000-4000-8000-000000000001",
  plan_tier: "light",
  included_minutes: 30,
  overage_rate_yen: 40,
  monthly_price_yen: 980,
  transcript_retention_days: 30,
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

function makeSubRepo(
  row: SubscriptionRow,
  usedSeconds: number,
): SubscriptionRepository {
  return {
    findByUserId: vi.fn().mockResolvedValue({ ok: true, data: row }),
    upsert: vi.fn().mockResolvedValue({ ok: true, data: row }),
    updatePlan: vi.fn().mockResolvedValue({ ok: true, data: row }),
    getUsedSecondsInPeriod: vi.fn().mockResolvedValue({ ok: true, data: usedSeconds }),
  };
}

// --- テスト ---

describe("SubscriptionService.getSubscription", () => {
  it("未使用時: usedMinutes=0, remainingMinutes=30(Lightプラン)", async () => {
    const repo = makeSubRepo(baseRow, 0);
    const service = createSubscriptionService({ subscriptionRepo: repo });

    const result = await service.getSubscription(makeUserId());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.usedMinutes).toBe(0);
    expect(result.data.remainingMinutes).toBe(30);
    expect(result.data.plan.tier).toBe("light");
  });

  it("30秒使用: usedMinutes=1(切り上げ), remainingMinutes=29", async () => {
    const repo = makeSubRepo(baseRow, 30); // 30秒使用
    const service = createSubscriptionService({ subscriptionRepo: repo });

    const result = await service.getSubscription(makeUserId());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.usedMinutes).toBe(1); // ceil(30/60) = 1
    expect(result.data.remainingMinutes).toBe(29); // floor((1800-30)/60) = 29
  });

  it("IAP Apple チャネル: iapPlatform = apple", async () => {
    const appleRow: SubscriptionRow = {
      ...baseRow,
      purchase_channel: "iap_apple",
      stripe_subscription_id: null,
      iap_original_transaction_id: "orig_tx_123",
    };
    const repo = makeSubRepo(appleRow, 0);
    const service = createSubscriptionService({ subscriptionRepo: repo });

    const result = await service.getSubscription(makeUserId());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.iapPlatform).toBe("apple");
  });

  it("Stripe Web チャネル: iapPlatform = null", async () => {
    const repo = makeSubRepo(baseRow, 0);
    const service = createSubscriptionService({ subscriptionRepo: repo });

    const result = await service.getSubscription(makeUserId());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.iapPlatform).toBeNull();
  });
});

describe("SubscriptionService.canStartCall", () => {
  it("残量 >= 1 分の場合: true", async () => {
    const repo = makeSubRepo(baseRow, 0); // 残30分
    const service = createSubscriptionService({ subscriptionRepo: repo });

    const result = await service.canStartCall(makeUserId());
    expect(result.ok).toBe(true);
  });

  it("Free プランで残量 0: BILLING_INSUFFICIENT_BALANCE", async () => {
    const freeRow: SubscriptionRow = {
      ...baseRow,
      plan_tier: "free",
      included_minutes: 5,
      overage_rate_yen: 0,
      purchase_channel: "free",
      stripe_subscription_id: null,
      stripe_customer_id: null,
    };
    const repo = makeSubRepo(freeRow, 300); // 5分使い切り
    const service = createSubscriptionService({ subscriptionRepo: repo });

    const result = await service.canStartCall(makeUserId());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_INSUFFICIENT_BALANCE");
  });

  it("有料プランで残量 0 だが支払い方法あり: true（超過課金）", async () => {
    const repo = makeSubRepo(baseRow, 1800); // 30分使い切り (stripe_subscription_id あり)
    const service = createSubscriptionService({ subscriptionRepo: repo });

    const result = await service.canStartCall(makeUserId());
    expect(result.ok).toBe(true);
  });
});
