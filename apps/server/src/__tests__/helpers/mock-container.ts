/**
 * テスト用 in-memory モックコンテナ
 *
 * 実際の Supabase 接続なしでエンドポイントをテストするためのモック。
 */

import { vi } from "vitest";
import type { AppContainer } from "../../container.js";
import { createEventBus } from "../../adapters/event-bus.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserId, RoomId, ParticipantId } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";
import type { RoomState } from "@trancall/room";

const MOCK_USER_ID = "11111111-1111-4111-8111-111111111111" as UserId;
const MOCK_ROOM_ID = "22222222-2222-4222-8222-222222222222" as RoomId;
const MOCK_PARTICIPANT_ID = "33333333-3333-4333-8333-333333333333" as ParticipantId;
// #43 テスト用: room の参加者ではないユーザー (認可チェックの 403 検証に使う)
const MOCK_OTHER_USER_ID = "44444444-4444-4444-8444-444444444444" as UserId;

function makeRoomState(): RoomState {
  return {
    roomId: MOCK_ROOM_ID,
    status: "waiting",
    translationEnabled: true,
    createdBy: MOCK_USER_ID,
    createdAt: new Date().toISOString(),
    endedAt: null,
    // #43: GET /:id・/leave・/token の参加者チェックが通るよう、認証済みユーザー
    // (MOCK_USER_ID、getUser モックが常にこの id を返す) を host として含める。
    participants: [
      {
        id: MOCK_PARTICIPANT_ID,
        userId: MOCK_USER_ID,
        role: "host",
        isMuted: false,
        joinedAt: new Date().toISOString(),
        leftAt: null,
      },
    ],
  };
}

export function createMockContainer(): AppContainer {
  const eventBus = createEventBus();

  // Mock Supabase query builder chain
  const mockQueryChain = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  // Make all chain methods return the chain itself
  for (const key of Object.keys(mockQueryChain)) {
    if (key !== "single" && key !== "maybeSingle") {
      const anyChain = mockQueryChain as Record<string, ReturnType<typeof vi.fn>>;
      anyChain[key]?.mockReturnValue(mockQueryChain);
    }
  }

  const mockFrom = vi.fn().mockReturnValue(mockQueryChain);
  const mockSchema = vi.fn().mockReturnValue({ from: mockFrom });

  // Mock Supabase client
  const mockSupabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: MOCK_USER_ID, email: "test@example.com", created_at: new Date().toISOString(), email_confirmed_at: new Date().toISOString() } },
        error: null,
      }),
      signUp: vi.fn().mockResolvedValue({
        data: {
          session: { access_token: "mock-token", refresh_token: "mock-refresh", expires_at: Date.now() / 1000 + 3600 },
          user: { id: MOCK_USER_ID, email: "test@example.com", created_at: new Date().toISOString() },
        },
        error: null,
      }),
      signInWithPassword: vi.fn().mockResolvedValue({
        data: {
          session: { access_token: "mock-token", refresh_token: "mock-refresh", expires_at: Date.now() / 1000 + 3600 },
          user: { id: MOCK_USER_ID, email: "test@example.com", created_at: new Date().toISOString() },
        },
        error: null,
      }),
    },
    schema: mockSchema,
    from: mockFrom,
  } as unknown as SupabaseClient;

  // Auth facade mock
  const auth = {
    getProfile: vi.fn().mockResolvedValue(ok({
      userId: MOCK_USER_ID,
      email: "test@example.com",
      displayName: "Test User",
      nativeLanguage: "ja",
      trancallId: "testuser",
      updatedAt: new Date().toISOString(),
    })),
    // Sprint 3 T-10 追加
    recordConsent: vi.fn().mockResolvedValue(ok(true)),
    getRequiredConsents: vi.fn().mockResolvedValue(ok([])),
    revokeConsent: vi.fn().mockResolvedValue(ok(true)),
    // Issue #67: signup 完了通知 (auth.user_registered publish)
    publishUserRegistered: vi.fn().mockResolvedValue(ok(true)),
    // Issue #72.1: facade バイパス是正で追加した書き込み用メソッド
    updateProfile: vi.fn().mockResolvedValue(ok({
      userId: MOCK_USER_ID,
      email: "test@example.com",
      displayName: "Test User",
      nativeLanguage: "ja",
      trancallId: "testuser",
      updatedAt: new Date().toISOString(),
    })),
    recordLegacyConsentVersion: vi.fn().mockResolvedValue(ok(true)),
    // デフォルトは「未退会」。account-routes(-atomicity).test.ts は個別に上書きする。
    getProfileDeletionStatus: vi.fn().mockResolvedValue(ok(null)),
    setProfileDeletedAt: vi.fn().mockResolvedValue(ok(true)),
  };

  // Billing facade mock
  const billing = {
    getSubscription: vi.fn().mockResolvedValue(ok({
      // 旧来のフラットフィールド (billing-routes.test.ts 等が参照)
      planTier: "free",
      includedMinutes: 5,
      usedMinutes: 0,
      remainingMinutes: 5,
      subscriptionStatus: "active",
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date().toISOString(),
      cancelAtPeriodEnd: false,
      // 実際の SubscriptionState (packages/billing/src/schemas.ts) が持つ nested 形。
      // agent-routes.ts の transcript.delta retention 計算 (#48) が plan.tier を参照する。
      plan: {
        tier: "free",
        includedMinutes: 5,
        overageRateYen: 0,
        monthlyPriceYen: 0,
        transcriptRetentionDays: 7,
      },
    })),
    canStartCall: vi.fn().mockResolvedValue(ok(true)),
    reserveMinutes: vi.fn().mockResolvedValue(ok(true)),
    reconcile: vi.fn().mockResolvedValue(ok({
      planTier: "free",
      includedMinutes: 5,
      usedMinutes: 2,
      remainingMinutes: 3,
      subscriptionStatus: "active",
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date().toISOString(),
      cancelAtPeriodEnd: false,
    })),
    refundMinutes: vi.fn().mockResolvedValue(ok(true)),
    recordUsage: vi.fn().mockResolvedValue(ok({ planTier: "free" })),
    createCheckoutSession: vi.fn().mockResolvedValue(ok({ url: "https://checkout.stripe.com/test" })),
    handleStripeWebhook: vi.fn().mockResolvedValue(ok(true)),
    handleAppleIapWebhook: vi.fn().mockResolvedValue(ok(true)),
    handleGoogleIapWebhook: vi.fn().mockResolvedValue(ok(true)),
    // Sprint 3 T-10 追加
    getPlanComparison: vi.fn().mockResolvedValue(ok({
      currentTier: "free",
      plans: [],
    })),
    previewUpgrade: vi.fn().mockResolvedValue(ok({
      currentTier: "free",
      targetTier: "standard",
      proratedAmountYen: 0,
      nextBillingDate: new Date().toISOString(),
      effectiveImmediately: true,
      confirmationRequired: false,
    })),
    recordIapTransaction: vi.fn().mockResolvedValue(ok({
      planTier: "standard",
      includedMinutes: 120,
      usedMinutes: 0,
      remainingMinutes: 120,
      subscriptionStatus: "active",
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date().toISOString(),
      cancelAtPeriodEnd: false,
    })),
    startExternalPurchase: vi.fn().mockResolvedValue(ok({ redirectUrl: "https://checkout.stripe.com/external-test" })),
    completeExternalPurchase: vi.fn().mockResolvedValue(ok({
      planTier: "standard",
      includedMinutes: 120,
      usedMinutes: 0,
      remainingMinutes: 120,
      subscriptionStatus: "active",
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date().toISOString(),
      cancelAtPeriodEnd: false,
    })),
    restorePurchases: vi.fn().mockResolvedValue(ok({ restoredCount: 0, subscription: null })),
    cancelSubscription: vi.fn().mockResolvedValue(ok({
      planTier: "free",
      includedMinutes: 5,
      usedMinutes: 0,
      remainingMinutes: 5,
      subscriptionStatus: "active",
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date().toISOString(),
      cancelAtPeriodEnd: true,
    })),
    // #65: account-routes.ts の POST /api/account/restore が使う (退会取消時の Stripe 側
    // cancel_at_period_end 取り消し込み復元)
    reactivateSubscription: vi.fn().mockResolvedValue(ok({
      planTier: "standard",
      includedMinutes: 120,
      usedMinutes: 0,
      remainingMinutes: 120,
      subscriptionStatus: "active",
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date().toISOString(),
      cancelAtPeriodEnd: false,
    })),
    // P-2: POST /api/billing/storekit-external/report
    reportExternalPurchaseTransaction: vi.fn().mockResolvedValue(ok({ queuedForAppleReport: true })),
  };

  // Contact facade mock
  const contact = {
    // Issue #72.2: listContacts は Result<ContactEntry[]> を返す
    listContacts: vi.fn().mockResolvedValue(ok([])),
    addContact: vi.fn().mockResolvedValue(ok({
      contactId: "10101010-1010-4010-8010-101010101010",
      userId: MOCK_USER_ID,
      contactUserId: "11011011-0110-4110-8110-110110110110" as UserId,
      displayName: "Contact User",
      nativeLanguage: "en",
      avatarUrl: null,
      addedAt: new Date().toISOString(),
      isFavorite: false,
      trancallId: "contactuser",
    })),
    removeContact: vi.fn().mockResolvedValue(ok(true)),
    searchUsers: vi.fn().mockResolvedValue([]),
    blockUser: vi.fn().mockResolvedValue(ok(true)),
    unblockUser: vi.fn().mockResolvedValue(ok(true)),
    reportUser: vi.fn().mockResolvedValue(ok(true)),
    toggleFavorite: vi.fn().mockResolvedValue(ok(true)),
    createInviteLink: vi.fn().mockResolvedValue(ok({
      url: "https://trancall.app/invite/abc123",
      token: "abc123",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })),
    consumeInviteLink: vi.fn().mockResolvedValue(ok({})),
  };

  // Media facade mock
  const media = {
    issueAccessToken: vi.fn().mockResolvedValue(ok({
      token: "livekit-jwt-token",
      livekitUrl: "wss://livekit.test",
    })),
    createRoom: vi.fn().mockResolvedValue(ok(undefined)),
    deleteRoom: vi.fn().mockResolvedValue(ok(undefined)),
  };

  // Notification facade mock
  const notification = {
    registerDevice: vi.fn().mockResolvedValue(ok(true)),
    unregisterDevice: vi.fn().mockResolvedValue(ok(true)),
    sendIncomingCall: vi.fn().mockResolvedValue(ok(true)),
    sendMissedCall: vi.fn().mockResolvedValue(ok(true)),
  };

  // Transcript facade mock
  const transcript = {
    appendFinalSegment: vi.fn().mockResolvedValue(ok(true)),
    getTranscript: vi.fn().mockResolvedValue(ok({
      roomId: MOCK_ROOM_ID,
      segments: [],
      duration: 0,
      participantCount: 0,
      generatedAt: new Date().toISOString(),
    })),
    searchSegments: vi.fn().mockResolvedValue(ok([])),
    deleteAccess: vi.fn().mockResolvedValue(ok(true)),
    // T-9 Round 2 指摘: 501 stub を ok() に更新 (TranscriptFacade.exportTranscript 実装済み)
    exportTranscript: vi.fn().mockResolvedValue(ok({
      contentBase64: "dGVzdA==",
      mime: "text/plain; charset=utf-8",
      filename: "transcript-test.txt",
    })),
    validateLiveDelta: vi.fn().mockReturnValue(ok({})),
  };

  // Translation facade mock
  const translation = {
    handleAgentEvent: vi.fn().mockResolvedValue(ok(true)),
    // #67: TranslationUsage の完全な形 (agent-routes.ts の publishTranslationEndedEvent が
    // sessionId/roomId/sourceParticipantId/outputLanguage/startedAt/endedAt/reason を使う)
    getUsage: vi.fn().mockResolvedValue(ok({
      sessionId: "55555555-5555-4555-8555-555555555555",
      roomId: MOCK_ROOM_ID,
      sourceParticipantId: MOCK_PARTICIPANT_ID,
      outputLanguage: "en",
      durationMs: 60000,
      billableSeconds: 60,
      startedAt: new Date(Date.now() - 60000).toISOString(),
      endedAt: new Date().toISOString(),
      reason: "participant_left",
    })),
    shouldStartSession: vi.fn().mockReturnValue(true),
    validateLiveDelta: vi.fn().mockReturnValue(ok({})),
  };

  // #46: RoomReservationSessionRepository mock — 実際の Map で状態を持ち、room-routes.ts の
  // POST /api/rooms (save) → POST /api/rooms/:id/leave (findByRoomId) の往復を実挙動として
  // 検証できるようにする (#53 テスト、単なる vi.fn().mockResolvedValue の静的スタブでは
  // sessionId の対応付けを検証できないため)。
  const roomReservationSessionStore = new Map<
    string,
    { userId: string; sessionId: string }
  >();
  const roomReservationSessionRepo = {
    save: vi.fn(async (params: { roomId: string; userId: string; sessionId: string }) => {
      roomReservationSessionStore.set(params.roomId, {
        userId: params.userId,
        sessionId: params.sessionId,
      });
      return ok(true);
    }),
    findByRoomId: vi.fn(async (roomId: string) => {
      const row = roomReservationSessionStore.get(roomId);
      return ok(
        row
          ? {
              roomId,
              userId: row.userId,
              sessionId: row.sessionId,
              createdAt: new Date().toISOString(),
            }
          : null,
      );
    }),
    deleteByRoomId: vi.fn(async (roomId: string) => {
      roomReservationSessionStore.delete(roomId);
      return ok(true);
    }),
  };

  // Room facade mock
  const room = {
    createCall: vi.fn().mockResolvedValue(ok(makeRoomState())),
    joinCall: vi.fn().mockResolvedValue(ok({ ...makeRoomState(), status: "active" })),
    endCall: vi.fn().mockResolvedValue(ok({ ...makeRoomState(), status: "ended" })),
    getState: vi.fn().mockResolvedValue(ok(makeRoomState())),
    // Sprint 3 T-10 追加
    getRoomHistory: vi.fn().mockResolvedValue(ok({ rooms: [], nextCursor: null })),
  };

  // #27: account-routes.ts が退会/復元時にサブスクリプションの cancelAtPeriodEnd を
  // 直接操作するために使う SubscriptionRepository のモック。
  const subscriptionRow = {
    id: "66666666-6666-4666-8666-666666666666",
    user_id: MOCK_USER_ID,
    plan_tier: "standard",
    included_minutes: 120,
    overage_rate_yen: 10,
    monthly_price_yen: 1980,
    transcript_retention_days: 30,
    cancel_at_period_end: false,
    purchase_channel: "stripe_web",
    stripe_customer_id: "cus_test123",
    stripe_subscription_id: "sub_test123",
    iap_original_transaction_id: null,
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const subscriptionRepo = {
    findByUserId: vi.fn().mockResolvedValue(ok(subscriptionRow)),
    upsert: vi.fn().mockResolvedValue(ok(subscriptionRow)),
    updatePlan: vi.fn().mockResolvedValue(ok({ ...subscriptionRow, cancel_at_period_end: false })),
    getUsedSecondsInPeriod: vi.fn().mockResolvedValue(ok(0)),
    findByIapOriginalTransactionId: vi.fn().mockResolvedValue(ok(null)),
    findByStripeSubscriptionId: vi.fn().mockResolvedValue(ok(null)),
  };

  // #23: billing-routes.ts の Apple Webhook 署名検証に使う IapAdapterConfig のモック。
  // bundleId/environment/trustedRootCertsPem を指定しないため、署名検証は
  // x5c チェーン内リンクの整合性のみをチェックする (テストの JWS フィクスチャと整合)。
  const iapAdapterConfig = {};

  return {
    supabase: mockSupabase,
    eventBus,
    auth,
    billing,
    contact,
    media,
    notification,
    transcript,
    translation,
    room,
    roomReservationSessionRepo,
    subscriptionRepo,
    iapAdapterConfig,
  } as unknown as AppContainer;
}

export { MOCK_USER_ID, MOCK_ROOM_ID, MOCK_PARTICIPANT_ID, MOCK_OTHER_USER_ID };
