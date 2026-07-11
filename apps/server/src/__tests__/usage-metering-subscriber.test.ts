/**
 * #46 usage metering subscriber テスト
 *
 * `translation.ended` DomainEvent を購読して billing.recordUsage (+ reconcile) を呼ぶ
 * apps/server/src/adapters/usage-metering-subscriber.ts の単体テスト。
 *
 * - roomId → billing 予約 (userId, sessionId) の対応付けを正しく解決して recordUsage に渡すこと
 *   (#46 の核心設計課題: translation.ended の sessionId は Agent 採番の translation
 *   sessionId であり、billing の予約 sessionId とは別物であることの検証)
 * - 重複配信 (同一イベントの再 publish) でも冪等な idempotencyKey が導出されること
 *   (実際の二重挿入防止は usage_windows.idempotency_key の UNIQUE 制約 + insertWindowIdempotent
 *   側の責務であり、本テストでは「同一の idempotencyKey が生成される」ことまでを検証する)
 * - 対応付けが見つからない場合は recordUsage を呼ばずスキップすること
 * - eventBus 購読配線 (registerUsageMeteringSubscriber が実際に "translation.ended" を
 *   subscribe し、publish で handler が呼ばれること)
 */

/* eslint-disable @typescript-eslint/unbound-method --
 * vi.mocked(...) は vitest の定番パターンだが、typescript-eslint の unbound-method は
 * 「メソッド参照を this なしで渡している」と誤検知する (実害なし)。ファイル全体で無効化する。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEventBus } from "../adapters/event-bus.js";
import { registerUsageMeteringSubscriber } from "../adapters/usage-metering-subscriber.js";
import type { BillingFacade } from "@trancall/billing";
import type { AuthFacade } from "@trancall/auth";
import type { RoomReservationSessionRepository } from "../adapters/repositories/billing/room-reservation-session-repository.supabase.js";
import { ok, err } from "@trancall/shared-kernel";
import type { UserId, RoomId, ParticipantId, TranslationSessionId } from "@trancall/shared-kernel";
import type { TranslationEndedEvent } from "@trancall/translation";

const MAPPED_USER_ID = "11111111-1111-4111-8111-111111111111" as UserId;
const ROOM_ID = "22222222-2222-4222-8222-222222222222" as RoomId;
const SOURCE_PARTICIPANT_ID = "33333333-3333-4333-8333-333333333333" as ParticipantId;
// billing 予約 sessionId (room-routes.ts が独自採番するもの)。translation 側 sessionId とは別物。
const RESERVATION_SESSION_ID = "44444444-4444-4444-8444-444444444444" as TranslationSessionId;

function makeTranslationEndedEvent(
  overrides: Partial<TranslationEndedEvent["payload"]> = {},
): TranslationEndedEvent {
  return {
    eventId: "55555555-5555-4555-8555-555555555555",
    occurredAt: new Date().toISOString(),
    // aggregateId は translation 側 sessionId (Agent 採番、billing 予約 sessionId とは別物)
    aggregateId: "66666666-6666-4666-8666-666666666666",
    type: "translation.ended",
    payload: {
      // #46 の核心: この sessionId (Agent 採番) は billing 予約の RESERVATION_SESSION_ID とは
      // 異なる。roomId 経由で解決されるべきは RESERVATION_SESSION_ID の方。
      sessionId: "66666666-6666-4666-8666-666666666666" as TranslationSessionId,
      roomId: ROOM_ID,
      sourceParticipantId: SOURCE_PARTICIPANT_ID,
      outputLanguage: "en",
      durationMs: 60000,
      billableSeconds: 60,
      startedAt: new Date(Date.now() - 60000).toISOString(),
      endedAt: new Date().toISOString(),
      reason: "participant_left",
      ...overrides,
    },
  };
}

function makeBillingMock(): BillingFacade {
  return {
    recordUsage: vi.fn().mockResolvedValue(
      ok({
        userId: MAPPED_USER_ID,
        plan: { tier: "free", includedMinutes: 5, overageRateYen: 0, monthlyPriceYen: 0, transcriptRetentionDays: 7 },
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date().toISOString(),
        usedMinutes: 1,
        remainingMinutes: 4,
        cancelAtPeriodEnd: false,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        iapOriginalTransactionId: null,
        iapPlatform: null,
      }),
    ),
    reconcile: vi.fn().mockResolvedValue(
      ok({
        userId: MAPPED_USER_ID,
        plan: { tier: "free", includedMinutes: 5, overageRateYen: 0, monthlyPriceYen: 0, transcriptRetentionDays: 7 },
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date().toISOString(),
        usedMinutes: 1,
        remainingMinutes: 4,
        cancelAtPeriodEnd: false,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        iapOriginalTransactionId: null,
        iapPlatform: null,
      }),
    ),
    // 本テストでは未使用のメソッド群 (型を満たすためのスタブ)
    getSubscription: vi.fn(),
    canStartCall: vi.fn(),
    reserveMinutes: vi.fn(),
    refundMinutes: vi.fn(),
    createCheckoutSession: vi.fn(),
    handleStripeWebhook: vi.fn(),
    handleAppleIapWebhook: vi.fn(),
    handleGoogleIapWebhook: vi.fn(),
    getPlanComparison: vi.fn(),
    previewUpgrade: vi.fn(),
    recordIapTransaction: vi.fn(),
    startExternalPurchase: vi.fn(),
    completeExternalPurchase: vi.fn(),
    cancelSubscription: vi.fn(),
    reactivateSubscription: vi.fn(),
    restorePurchases: vi.fn(),
    reportExternalPurchaseTransaction: vi.fn(),
  };
}

function makeAuthMock(): AuthFacade {
  return {
    getProfile: vi.fn().mockResolvedValue(
      ok({
        userId: MAPPED_USER_ID,
        email: "speaker@example.com",
        displayName: "Speaker",
        nativeLanguage: "ja",
        trancallId: "speaker",
        updatedAt: new Date().toISOString(),
      }),
    ),
  } as unknown as AuthFacade;
}

function makeRoomReservationSessionRepoMock(
  mapping: { userId: string; sessionId: string } | null,
): RoomReservationSessionRepository {
  return {
    save: vi.fn().mockResolvedValue(ok(true)),
    findByRoomId: vi.fn().mockResolvedValue(
      ok(
        mapping
          ? {
              roomId: ROOM_ID,
              userId: mapping.userId,
              sessionId: mapping.sessionId,
              createdAt: new Date().toISOString(),
            }
          : null,
      ),
    ),
    deleteByRoomId: vi.fn().mockResolvedValue(ok(true)),
  };
}

describe("registerUsageMeteringSubscriber (#46)", () => {
  let billing: BillingFacade;
  let auth: AuthFacade;

  beforeEach(() => {
    billing = makeBillingMock();
    auth = makeAuthMock();
  });

  it("roomId から解決した billing 予約 sessionId (Agent 採番の translation sessionId とは別物) で recordUsage を呼ぶ", async () => {
    const eventBus = createEventBus();
    const roomReservationSessionRepo = makeRoomReservationSessionRepoMock({
      userId: MAPPED_USER_ID,
      sessionId: RESERVATION_SESSION_ID,
    });
    registerUsageMeteringSubscriber(eventBus, { billing, auth, roomReservationSessionRepo });

    await eventBus.publish(makeTranslationEndedEvent());

    expect(vi.mocked(roomReservationSessionRepo.findByRoomId)).toHaveBeenCalledWith(ROOM_ID);
    expect(vi.mocked(billing.recordUsage)).toHaveBeenCalledTimes(1);

    const cmd = vi.mocked(billing.recordUsage).mock.calls[0]?.[0];
    expect(cmd).toBeDefined();
    expect(cmd?.userId).toBe(MAPPED_USER_ID);
    // #46 核心: recordUsage の sessionId は billing 予約 sessionId (RESERVATION_SESSION_ID)
    // であり、translation.ended payload.sessionId (Agent 採番、"66666666-...") ではない。
    expect(cmd?.sessionId).toBe(RESERVATION_SESSION_ID);
    expect(cmd?.sessionId).not.toBe("66666666-6666-4666-8666-666666666666");
    expect(cmd?.roomId).toBe(ROOM_ID);
    expect(cmd?.durationSeconds).toBe(60);
    expect(cmd?.languagePair).toBe("ja-en");

    // reconcile も billing 予約 sessionId で呼ばれる
    expect(vi.mocked(billing.reconcile)).toHaveBeenCalledWith(MAPPED_USER_ID, RESERVATION_SESSION_ID);
  });

  it("重複配信 (同一セッションの translation.ended 再 publish) でも同一の idempotencyKey が導出される (二重記録防止の前提)", async () => {
    const eventBus = createEventBus();
    const roomReservationSessionRepo = makeRoomReservationSessionRepoMock({
      userId: MAPPED_USER_ID,
      sessionId: RESERVATION_SESSION_ID,
    });
    registerUsageMeteringSubscriber(eventBus, { billing, auth, roomReservationSessionRepo });

    const event = makeTranslationEndedEvent();
    await eventBus.publish(event);
    await eventBus.publish(event);

    expect(vi.mocked(billing.recordUsage)).toHaveBeenCalledTimes(2);
    const firstKey = vi.mocked(billing.recordUsage).mock.calls[0]?.[0]?.idempotencyKey;
    const secondKey = vi.mocked(billing.recordUsage).mock.calls[1]?.[0]?.idempotencyKey;
    expect(firstKey).toBeDefined();
    // 実際の二重挿入防止は usage_windows.idempotency_key の UNIQUE 制約 +
    // insertWindowIdempotent (apps/server/src/adapters/repositories/billing/
    // usage-repository.supabase.ts) が担うが、その前提として同一イベントからは
    // 常に同一の idempotencyKey が導出される必要がある。
    expect(secondKey).toBe(firstKey);
  });

  it("roomId に対応する billing 予約が見つからない場合は recordUsage をスキップする", async () => {
    const eventBus = createEventBus();
    const roomReservationSessionRepo = makeRoomReservationSessionRepoMock(null);
    registerUsageMeteringSubscriber(eventBus, { billing, auth, roomReservationSessionRepo });

    await eventBus.publish(makeTranslationEndedEvent());

    expect(vi.mocked(billing.recordUsage)).not.toHaveBeenCalled();
    expect(vi.mocked(billing.reconcile)).not.toHaveBeenCalled();
  });

  it("room_reservation_sessions の lookup 自体が失敗した場合も recordUsage をスキップする (best-effort)", async () => {
    const eventBus = createEventBus();
    const roomReservationSessionRepo: RoomReservationSessionRepository = {
      save: vi.fn().mockResolvedValue(ok(true)),
      findByRoomId: vi
        .fn()
        .mockResolvedValue(err({ code: "INTERNAL_ERROR", message: "db down", retryable: true })),
      deleteByRoomId: vi.fn().mockResolvedValue(ok(true)),
    };
    registerUsageMeteringSubscriber(eventBus, { billing, auth, roomReservationSessionRepo });

    await expect(eventBus.publish(makeTranslationEndedEvent())).resolves.toBeUndefined();
    expect(vi.mocked(billing.recordUsage)).not.toHaveBeenCalled();
  });

  it("eventBus 購読配線: registerUsageMeteringSubscriber は translation.ended を subscribe し、publish で handler が呼ばれる", async () => {
    const eventBus = createEventBus();
    const roomReservationSessionRepo = makeRoomReservationSessionRepoMock({
      userId: MAPPED_USER_ID,
      sessionId: RESERVATION_SESSION_ID,
    });
    const unsubscribe = registerUsageMeteringSubscriber(eventBus, {
      billing,
      auth,
      roomReservationSessionRepo,
    });
    expect(typeof unsubscribe).toBe("function");

    await eventBus.publish(makeTranslationEndedEvent());
    expect(vi.mocked(billing.recordUsage)).toHaveBeenCalledTimes(1);

    // unsubscribe 後は publish しても呼ばれない
    unsubscribe();
    await eventBus.publish(makeTranslationEndedEvent());
    expect(vi.mocked(billing.recordUsage)).toHaveBeenCalledTimes(1);
  });

  it("billing.recordUsage が失敗しても例外を投げない (best-effort、EventBus.publish が rethrow しない)", async () => {
    const eventBus = createEventBus();
    const roomReservationSessionRepo = makeRoomReservationSessionRepoMock({
      userId: MAPPED_USER_ID,
      sessionId: RESERVATION_SESSION_ID,
    });
    vi.mocked(billing.recordUsage).mockResolvedValueOnce(
      err({ code: "INTERNAL_ERROR", message: "insert failed", retryable: true }),
    );
    registerUsageMeteringSubscriber(eventBus, { billing, auth, roomReservationSessionRepo });

    await expect(eventBus.publish(makeTranslationEndedEvent())).resolves.toBeUndefined();
    // recordUsage が失敗した場合、reconcile は呼ばれない (billing.recordUsage の結果を
    // 確認してから reconcile する設計のため)
    expect(vi.mocked(billing.reconcile)).not.toHaveBeenCalled();
  });
});
