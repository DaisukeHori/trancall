/**
 * テスト用 in-memory モックコンテナ
 *
 * 実際の Supabase 接続なしでエンドポイントをテストするためのモック。
 */

import { vi } from "vitest";
import type { AppContainer } from "../../container.js";
import { createEventBus } from "../../adapters/event-bus.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserId, RoomId } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";
import type { RoomState } from "@trancall/room";

const MOCK_USER_ID = "11111111-1111-4111-8111-111111111111" as UserId;
const MOCK_ROOM_ID = "22222222-2222-4222-8222-222222222222" as RoomId;

function makeRoomState(): RoomState {
  return {
    roomId: MOCK_ROOM_ID,
    status: "waiting",
    translationEnabled: true,
    createdBy: MOCK_USER_ID,
    createdAt: new Date().toISOString(),
    endedAt: null,
    participants: [],
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
  };

  // Billing facade mock
  const billing = {
    getSubscription: vi.fn().mockResolvedValue(ok({
      planTier: "free",
      includedMinutes: 5,
      usedMinutes: 0,
      remainingMinutes: 5,
      subscriptionStatus: "active",
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date().toISOString(),
      cancelAtPeriodEnd: false,
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
  };

  // Contact facade mock
  const contact = {
    listContacts: vi.fn().mockResolvedValue([]),
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
    getUsage: vi.fn().mockResolvedValue(ok({ billableSeconds: 60, durationMs: 60000 })),
    shouldStartSession: vi.fn().mockReturnValue(true),
    validateLiveDelta: vi.fn().mockReturnValue(ok({})),
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
  } as unknown as AppContainer;
}

export { MOCK_USER_ID, MOCK_ROOM_ID };
