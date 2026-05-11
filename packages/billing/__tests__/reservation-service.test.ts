/**
 * ReservationService テスト
 *
 * - reserveMinutesWithSession: 残量チェック + 予約作成
 * - reconcile: 実消費精算
 * - refundMinutes: 異常終了時の解放
 */

import { describe, expect, it, vi } from "vitest";

import {
  brandUserId,
  brandTranslationSessionId,
  type UserId,
  type TranslationSessionId,
} from "@trancall/shared-kernel";

import { createReservationService } from "../src/services/reservation-service.js";
import type { SubscriptionRepository } from "../src/repositories/subscription-repository.js";
import type { UsageRepository } from "../src/repositories/usage-repository.js";
import type { ReservationRepository } from "../src/repositories/reservation-repository.js";
import type { SubscriptionRow, UsageReservation, UsageWindow } from "../src/schemas.js";

// --- ヘルパー ---

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

const baseReservation: UsageReservation = {
  id: "00000000-0000-4000-8000-000000000030",
  userId: makeUserId(),
  sessionId: makeSessionId(),
  reservedMinutes: 5,
  consumedMinutes: 0,
  status: "active",
  createdAt: "2026-05-10T10:00:00.000Z",
  reconciledAt: null,
};

const reconciledReservation: UsageReservation = {
  ...baseReservation,
  consumedMinutes: 2,
  status: "reconciled",
  reconciledAt: "2026-05-10T10:05:00.000Z",
};

function makeSubRepo(usedSeconds: number): SubscriptionRepository {
  return {
    findByUserId: vi.fn().mockResolvedValue({ ok: true, data: baseRow }),
    upsert: vi.fn().mockResolvedValue({ ok: true, data: baseRow }),
    updatePlan: vi.fn().mockResolvedValue({ ok: true, data: baseRow }),
    getUsedSecondsInPeriod: vi.fn().mockResolvedValue({ ok: true, data: usedSeconds }),
  };
}

// --- テスト ---

describe("ReservationService.reserveMinutesWithSession", () => {
  it("残量十分な場合: 予約作成成功", async () => {
    const subRepo = makeSubRepo(0); // 残30分
    const usageRepo: UsageRepository = {
      insertWindowIdempotent: vi.fn(),
      findBySessionId: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      sumDurationSecondsInPeriod: vi.fn().mockResolvedValue({ ok: true, data: 0 }),
    };
    const reservationRepo: ReservationRepository = {
      create: vi.fn().mockResolvedValue({ ok: true, data: baseReservation }),
      findActiveBySessionId: vi.fn().mockResolvedValue({ ok: true, data: null }),
      reconcile: vi.fn().mockResolvedValue({ ok: true, data: reconciledReservation }),
      expire: vi.fn().mockResolvedValue({ ok: true, data: null }),
    };

    const service = createReservationService({ subscriptionRepo: subRepo, usageRepo, reservationRepo });
    const result = await service.reserveMinutesWithSession(makeUserId(), makeSessionId(), 5);

    expect(result.ok).toBe(true);
    expect(reservationRepo.create).toHaveBeenCalledOnce();
  });

  it("残量不足かつ Free プランの場合: BILLING_INSUFFICIENT_BALANCE", async () => {
    const freeRow: SubscriptionRow = {
      ...baseRow,
      plan_tier: "free",
      included_minutes: 5,
      overage_rate_yen: 0,
      purchase_channel: "free",
      stripe_subscription_id: null,
      stripe_customer_id: null,
    };
    const subRepo: SubscriptionRepository = {
      findByUserId: vi.fn().mockResolvedValue({ ok: true, data: freeRow }),
      upsert: vi.fn(),
      updatePlan: vi.fn(),
      getUsedSecondsInPeriod: vi.fn().mockResolvedValue({ ok: true, data: 300 }), // 5分使い切り
    };
    const usageRepo: UsageRepository = {
      insertWindowIdempotent: vi.fn(),
      findBySessionId: vi.fn(),
      sumDurationSecondsInPeriod: vi.fn(),
    };
    const reservationRepo: ReservationRepository = {
      create: vi.fn(),
      findActiveBySessionId: vi.fn(),
      reconcile: vi.fn(),
      expire: vi.fn(),
    };

    const service = createReservationService({ subscriptionRepo: subRepo, usageRepo, reservationRepo });
    const result = await service.reserveMinutesWithSession(makeUserId(), makeSessionId(), 5);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_INSUFFICIENT_BALANCE");
  });
});

describe("ReservationService.reconcile", () => {
  it("実消費秒数から consumed_minutes を計算して更新", async () => {
    const windows: UsageWindow[] = [
      {
        id: "w1",
        userId: makeUserId(),
        sessionId: makeSessionId(),
        roomId: "00000000-0000-4000-8000-000000000003" as ReturnType<typeof brandTranslationSessionId>["data"],
        windowStart: "2026-05-10T10:00:00.000Z",
        windowEnd: "2026-05-10T10:00:30.000Z",
        durationSeconds: 30,
        languagePair: "ja-en",
        amountYen: 0,
        idempotencyKey: "key1",
        recordedAt: "2026-05-10T10:00:30.000Z",
      },
      {
        id: "w2",
        userId: makeUserId(),
        sessionId: makeSessionId(),
        roomId: "00000000-0000-4000-8000-000000000003" as ReturnType<typeof brandTranslationSessionId>["data"],
        windowStart: "2026-05-10T10:00:30.000Z",
        windowEnd: "2026-05-10T10:01:00.000Z",
        durationSeconds: 30,
        languagePair: "ja-en",
        amountYen: 0,
        idempotencyKey: "key2",
        recordedAt: "2026-05-10T10:01:00.000Z",
      },
    ];

    const subRepo = makeSubRepo(60); // 60秒使用
    const usageRepo: UsageRepository = {
      insertWindowIdempotent: vi.fn(),
      findBySessionId: vi.fn().mockResolvedValue({ ok: true, data: windows }),
      sumDurationSecondsInPeriod: vi.fn().mockResolvedValue({ ok: true, data: 60 }),
    };
    const reservationRepo: ReservationRepository = {
      create: vi.fn(),
      findActiveBySessionId: vi.fn().mockResolvedValue({ ok: true, data: baseReservation }),
      reconcile: vi.fn().mockResolvedValue({ ok: true, data: reconciledReservation }),
      expire: vi.fn(),
    };

    const service = createReservationService({ subscriptionRepo: subRepo, usageRepo, reservationRepo });
    const result = await service.reconcile(makeUserId(), makeSessionId());

    expect(result.ok).toBe(true);
    // 60秒 = ceil(60/60) = 1分
    expect(reservationRepo.reconcile).toHaveBeenCalledWith(makeSessionId(), 1);
  });
});

describe("ReservationService.refundMinutes", () => {
  it("予約を expired 状態にする", async () => {
    const subRepo = makeSubRepo(0);
    const usageRepo: UsageRepository = {
      insertWindowIdempotent: vi.fn(),
      findBySessionId: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      sumDurationSecondsInPeriod: vi.fn().mockResolvedValue({ ok: true, data: 0 }),
    };
    const expiredReservation: UsageReservation = { ...baseReservation, status: "expired" };
    const reservationRepo: ReservationRepository = {
      create: vi.fn(),
      findActiveBySessionId: vi.fn(),
      reconcile: vi.fn(),
      expire: vi.fn().mockResolvedValue({ ok: true, data: expiredReservation }),
    };

    const service = createReservationService({ subscriptionRepo: subRepo, usageRepo, reservationRepo });
    const result = await service.refundMinutes(makeSessionId());

    expect(result.ok).toBe(true);
    expect(reservationRepo.expire).toHaveBeenCalledWith(makeSessionId());
  });
});
