/**
 * UsageMeteringService テスト
 *
 * heartbeat 受信時の amount_yen 計算と usage_windows 冪等 INSERT を検証する。
 */

import { describe, expect, it, vi } from "vitest";

import {
  brandUserId,
  brandTranslationSessionId,
  brandRoomId,
  type AppError,
  type UserId,
  type TranslationSessionId,
  type RoomId,
} from "@trancall/shared-kernel";

import { createUsageMeteringService } from "../src/services/usage-metering.js";
import type { SubscriptionRepository } from "../src/repositories/subscription-repository.js";
import type { UsageRepository } from "../src/repositories/usage-repository.js";
import type { SubscriptionRow, RecordUsageCommand, UsageWindow } from "../src/schemas.js";

// --- テストヘルパー ---

function makeUserId(): UserId {
  const r = brandUserId("00000000-0000-4000-8000-000000000001");
  if (!r.success) throw new Error("test setup: brandUserId failed");
  return r.data;
}

function makeSessionId(): TranslationSessionId {
  const r = brandTranslationSessionId("00000000-0000-4000-8000-000000000002");
  if (!r.success) throw new Error("test setup: brandTranslationSessionId failed");
  return r.data;
}

function makeRoomId(): RoomId {
  const r = brandRoomId("00000000-0000-4000-8000-000000000003");
  if (!r.success) throw new Error("test setup: brandRoomId failed");
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

const baseWindow: UsageWindow = {
  id: "00000000-0000-4000-8000-000000000020",
  userId: makeUserId(),
  sessionId: makeSessionId(),
  roomId: makeRoomId(),
  windowStart: "2026-05-10T10:00:00.000Z",
  windowEnd: "2026-05-10T10:00:30.000Z",
  durationSeconds: 30,
  languagePair: "ja-en",
  amountYen: 0,
  idempotencyKey: "session-abc:heartbeat:0",
  recordedAt: "2026-05-10T10:00:30.000Z",
};

function makeCmd(): RecordUsageCommand {
  return {
    userId: makeUserId(),
    sessionId: makeSessionId(),
    roomId: makeRoomId(),
    windowStart: "2026-05-10T10:00:00.000Z",
    windowEnd: "2026-05-10T10:00:30.000Z",
    durationSeconds: 30,
    languagePair: "ja-en",
    idempotencyKey: "session-abc:heartbeat:0",
  };
}

function makeSubscriptionRepo(
  usedSeconds: number,
  row: SubscriptionRow = baseRow,
): SubscriptionRepository {
  return {
    findByUserId: vi.fn().mockResolvedValue({ ok: true, data: row }),
    upsert: vi.fn().mockResolvedValue({ ok: true, data: row }),
    updatePlan: vi.fn().mockResolvedValue({ ok: true, data: row }),
    getUsedSecondsInPeriod: vi.fn().mockResolvedValue({ ok: true, data: usedSeconds }),
  };
}

function makeUsageRepo(window: UsageWindow = baseWindow): UsageRepository {
  return {
    insertWindowIdempotent: vi.fn().mockResolvedValue({ ok: true, data: window }),
    findBySessionId: vi.fn().mockResolvedValue({ ok: true, data: [window] }),
    sumDurationSecondsInPeriod: vi.fn().mockResolvedValue({ ok: true, data: 0 }),
  };
}

// --- テスト ---

describe("UsageMeteringService.recordUsage", () => {
  it("含有分に余裕がある場合: amountYen = 0", async () => {
    const subRepo = makeSubscriptionRepo(0); // 0秒使用、残30分=1800秒
    const usageRepo = makeUsageRepo({ ...baseWindow, amountYen: 0 });
    const service = createUsageMeteringService({ subscriptionRepo: subRepo, usageRepo });

    const result = await service.recordUsage(makeCmd());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.amountYen).toBe(0);
    expect(result.data.shouldContinue).toBe(true);
  });

  it("含有分切れの場合: amountYen = ceil(30/60×40) = 20円", async () => {
    // 1800秒(30分)使用済み → 残0秒
    const subRepo = makeSubscriptionRepo(1800);
    const usageRepo = makeUsageRepo({ ...baseWindow, amountYen: 20 });
    const service = createUsageMeteringService({ subscriptionRepo: subRepo, usageRepo });

    const result = await service.recordUsage(makeCmd());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.amountYen).toBe(20);
  });

  it("stripe_subscription_id があれば超過でも shouldContinue = true", async () => {
    const subRepo = makeSubscriptionRepo(1800); // 含有分使い切り
    const usageRepo = makeUsageRepo({ ...baseWindow, amountYen: 20 });
    const service = createUsageMeteringService({ subscriptionRepo: subRepo, usageRepo });

    const result = await service.recordUsage(makeCmd());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.shouldContinue).toBe(true); // 支払い方法あり
  });

  it("Free プランで残量 0: shouldContinue = false", async () => {
    const freeRow: SubscriptionRow = {
      ...baseRow,
      plan_tier: "free",
      included_minutes: 5,
      overage_rate_yen: 0,
      purchase_channel: "free",
      stripe_subscription_id: null,
      stripe_customer_id: null,
    };
    const subRepo = makeSubscriptionRepo(300, freeRow); // 5分(300秒)使用済み
    const usageRepo = makeUsageRepo({ ...baseWindow, amountYen: 0 });
    const service = createUsageMeteringService({ subscriptionRepo: subRepo, usageRepo });

    const result = await service.recordUsage(makeCmd());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.shouldContinue).toBe(false);
  });

  it("サブスクリプションが見つからない場合はエラー", async () => {
    const subRepo: SubscriptionRepository = {
      findByUserId: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "NOT_FOUND", message: "not found", retryable: false } as AppError,
      }),
      upsert: vi.fn(),
      updatePlan: vi.fn(),
      getUsedSecondsInPeriod: vi.fn(),
    };
    const usageRepo = makeUsageRepo();
    const service = createUsageMeteringService({ subscriptionRepo: subRepo, usageRepo });

    const result = await service.recordUsage(makeCmd());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_SUBSCRIPTION_EXPIRED");
  });
});
