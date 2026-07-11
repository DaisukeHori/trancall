/**
 * DI コンテナ
 *
 * 全 repository, adapter, facade の組み立てを行う。
 * Fastify インスタンスへのデコレータ登録はここでは行わない (app.ts で行う)。
 */

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

// Facades
import { createAuthFacade } from "@trancall/auth";
import type {
  AuthFacade,
  AuthEventBus,
  AuthUserRegisteredEvent,
  AuthConsentRecordedEvent,
  AuthConsentRevokedEvent,
} from "@trancall/auth";
import {
  createBillingFacade,
  createStripeWebCheckoutAdapter,
  createIapAdapter,
  createExternalPurchaseAdapter,
} from "@trancall/billing";
import type { BillingFacade, SubscriptionRepository, IapAdapterConfig } from "@trancall/billing";
import {
  createContactFacade,
  createContactService,
  createBlockService,
  createSearchService,
  createReportService,
  createInviteService,
} from "@trancall/contact";
import type { ContactFacade } from "@trancall/contact";
import { createMediaFacade } from "@trancall/media";
import type { MediaFacade } from "@trancall/media";
import {
  createNotificationFacade,
  createDeviceTokenService,
  createPushDispatcher,
} from "@trancall/notification";
import type { NotificationFacade } from "@trancall/notification";
import { createTranscriptFacade } from "@trancall/transcript";
import type { TranscriptFacade } from "@trancall/transcript";
import { createTranslationFacade } from "@trancall/translation";
import type { TranslationFacade } from "@trancall/translation";
import { createRoomFacade } from "@trancall/room";
import type { RoomFacade } from "@trancall/room";

// Repositories — auth
import { createProfileRepository } from "./adapters/repositories/auth/profile-repository.supabase.js";
import { createProfileWriteRepository } from "./adapters/repositories/auth/profile-write-repository.supabase.js";
import { createLegacyConsentRepository } from "./adapters/repositories/auth/legacy-consent-repository.supabase.js";
import { createProfileDeletionRepository } from "./adapters/repositories/auth/profile-deletion-repository.supabase.js";
import { createConsentRepository } from "./adapters/repositories/auth/consent-repository.supabase.js";
import { createLegalDocVersionRepository } from "./adapters/repositories/auth/legal-doc-version-repository.supabase.js";
// Repositories — billing
import { createSubscriptionRepository } from "./adapters/repositories/billing/subscription-repository.supabase.js";
import { createUsageRepository } from "./adapters/repositories/billing/usage-repository.supabase.js";
import { createReservationRepository } from "./adapters/repositories/billing/reservation-repository.supabase.js";
import { createWebhookEventRepository } from "./adapters/repositories/billing/webhook-event-repository.supabase.js";
import { createExternalPurchaseTokenRepository } from "./adapters/repositories/billing/external-purchase-token-repository.supabase.js";
import { createRoomReservationSessionRepository } from "./adapters/repositories/billing/room-reservation-session-repository.supabase.js";
import type { RoomReservationSessionRepository } from "./adapters/repositories/billing/room-reservation-session-repository.supabase.js";
// Repositories — contact
import { createContactRepository } from "./adapters/repositories/contact/contact-repository.supabase.js";
import { createBlockRepository } from "./adapters/repositories/contact/block-repository.supabase.js";
import { createInviteRepository } from "./adapters/repositories/contact/invite-repository.supabase.js";
import { createProfileSearchRepository } from "./adapters/repositories/contact/profile-search-repository.supabase.js";
import { createReportRepository } from "./adapters/repositories/contact/report-repository.supabase.js";
// Repositories — notification
import { createDeviceTokenRepository } from "./adapters/repositories/notification/device-token-repository.supabase.js";
import { createPushLogRepository } from "./adapters/repositories/notification/push-log-repository.supabase.js";
// Repositories — transcript
import { createSegmentRepository } from "./adapters/repositories/transcript/segment-repository.supabase.js";
import { createAccessRepository } from "./adapters/repositories/transcript/access-repository.supabase.js";
// Repositories — translation
import { createTranslationSessionRepository } from "./adapters/repositories/translation/translation-session-repository.supabase.js";
import { createAgentMetricsRepository } from "./adapters/repositories/translation/agent-metrics-repository.supabase.js";
import { createTranslationEventOutboxRepository } from "./adapters/repositories/translation/translation-event-outbox-repository.supabase.js";
// Repositories — room
import { createRoomRepository } from "./adapters/repositories/room/room-repository.supabase.js";
import { createParticipantRepository } from "./adapters/repositories/room/participant-repository.supabase.js";
// Issue #69 (1): room が要求する BlockListRepository (contact の block_list への read-only view)
import { createRoomBlockListRepository } from "./adapters/repositories/room/block-list-repository.adapter.js";

// Adapters
import { buildLiveKitAdapter } from "./adapters/livekit-adapter.js";
import { buildStripeAdapter } from "./adapters/stripe-adapter.js";
import { buildAppleIapAdapter, buildGooglePlayAdapter } from "./adapters/iap-adapters.js";
import { buildApnsAdapter, buildFcmAdapter } from "./adapters/notification-adapters.js";

// EventBus
import { createEventBus } from "./adapters/event-bus.js";
import type { EventBus } from "./adapters/event-bus.js";

// #46: translation.ended 購読者 (usage metering)
import { registerUsageMeteringSubscriber } from "./adapters/usage-metering-subscriber.js";
// Issue #69 (2): room.participant_joined 購読者 (transcript_access 自動付与)
import { registerTranscriptAccessSubscriber } from "./adapters/transcript-access-subscriber.js";

import type { Config } from "./config.js";

export interface AppContainer {
  supabase: SupabaseClient;
  eventBus: EventBus;
  auth: AuthFacade;
  billing: BillingFacade;
  contact: ContactFacade;
  media: MediaFacade;
  notification: NotificationFacade;
  transcript: TranscriptFacade;
  translation: TranslationFacade;
  room: RoomFacade;
  /** #46: roomId ↔ billing 予約 sessionId 対応表。room-routes.ts が書き込み/読み取りに使う。 */
  roomReservationSessionRepo: RoomReservationSessionRepository;
  /**
   * #27/#65: billing facade の構築に使う SubscriptionRepository 実装。
   * 【#65 で解消】 account-routes.ts の POST /api/account/restore は従来これを
   * 直接使ってサブスクリプションの cancelAtPeriodEnd フラグを復元していたが、
   * BillingFacade.reactivateSubscription の追加により facade 経由に切り替わったため、
   * account-routes.ts への直接注入は不要になった。他の直接利用が必要になった場合に
   * 備え、コンテナからは引き続き参照可能にしておく。
   */
  subscriptionRepo: SubscriptionRepository;
  /**
   * #23: billing-routes.ts の Apple Webhook (signedPayload JWS) 署名検証に使う。
   * StoreKit 2 クライアント JWS 検証 (#40 iapAdapter) と同じ bundleId/environment/
   * trustedRootCertsPem 設定を Webhook 経路にも適用し、両経路の検証基準を揃える。
   */
  iapAdapterConfig: IapAdapterConfig;
}

export function buildContainer(config: Config): AppContainer {
  // Supabase client (service role)
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // EventBus
  const eventBus = createEventBus();

  // ── Repositories ──────────────────────────────────────────────────────────
  // auth
  const profileRepo = createProfileRepository(supabase);
  // Issue #72.1: PATCH /api/auth/profile / POST /api/auth/consent (レガシー) の
  // facade バイパスを解消するための書き込み用リポジトリ
  const profileWriteRepo = createProfileWriteRepository(supabase);
  const legacyConsentRepo = createLegacyConsentRepository(supabase);
  const profileDeletionRepo = createProfileDeletionRepository(supabase);
  const consentRepo = createConsentRepository(supabase);
  const legalDocRepo = createLegalDocVersionRepository(supabase);
  // billing
  const subscriptionRepo = createSubscriptionRepository(supabase);
  const usageRepo = createUsageRepository(supabase);
  const reservationRepo = createReservationRepository(supabase);
  const webhookEventRepo = createWebhookEventRepository(supabase);
  const externalPurchaseTokenRepo = createExternalPurchaseTokenRepository(supabase);
  const roomReservationSessionRepo = createRoomReservationSessionRepository(supabase);
  // contact
  const contactRepo = createContactRepository(supabase);
  const blockRepo = createBlockRepository(supabase);
  const inviteRepo = createInviteRepository(supabase);
  const profileSearchRepo = createProfileSearchRepository(supabase);
  const reportRepo = createReportRepository(supabase);
  // Issue #69 (1): room が要求する BlockListRepository。room モジュールは contact を
  // 直接 import できないため、apps/server が contact の BlockRepository 実装を
  // room 側の read-only インターフェースに合わせて包む。
  const roomBlockListRepo = createRoomBlockListRepository(blockRepo);
  // notification
  const deviceTokenRepo = createDeviceTokenRepository(supabase);
  const pushLogRepo = createPushLogRepository(supabase);
  // transcript
  const segmentRepo = createSegmentRepository(supabase);
  const accessRepo = createAccessRepository(supabase);
  // translation
  const sessionRepo = createTranslationSessionRepository(supabase);
  const metricsRepo = createAgentMetricsRepository(supabase);
  // outbox repo (translation facade には直接渡さない、将来の outbox worker 用)
  const _outboxRepo = createTranslationEventOutboxRepository(supabase);
  // room
  const roomRepo = createRoomRepository(supabase);
  const participantRepo = createParticipantRepository(supabase);

  // ── Facades (依存順に構築) ─────────────────────────────────────────────────
  // auth (新形式: profileRepo + consentRepo + legalDocRepo + eventBus)
  // AuthEventBus は EventBus の narrowed wrapper として注入する
  const authEventBus: AuthEventBus = {
    async publish(
      event: AuthUserRegisteredEvent | AuthConsentRecordedEvent | AuthConsentRevokedEvent,
    ): Promise<void> {
      // DomainEvent union に auth イベントを追加済みのため publish 可能
      await eventBus.publish(event);
    },
  };
  const auth = createAuthFacade({
    profileRepo,
    consentRepo,
    legalDocRepo,
    eventBus: authEventBus,
    profileWriteRepo,
    legacyConsentRepo,
    profileDeletionRepo,
  });

  // media (auth に依存)
  const liveKitAdapter = buildLiveKitAdapter(config, auth);
  const media = createMediaFacade(liveKitAdapter);

  // billing (新形式: externalPurchaseTokenRepo + T-7 拡張 adapter 3 種)
  const stripeAdapter = buildStripeAdapter(config);
  const appleIapAdapter = buildAppleIapAdapter();
  const googlePlayAdapter = buildGooglePlayAdapter();
  const stripeWebCheckoutAdapter = createStripeWebCheckoutAdapter({
    secretKey: config.STRIPE_SECRET_KEY,
    webhookSecret: config.STRIPE_WEBHOOK_SECRET,
    priceIds: {
      light: config.STRIPE_PRICE_ID_LIGHT,
      standard: config.STRIPE_PRICE_ID_STANDARD,
      business: config.STRIPE_PRICE_ID_BUSINESS,
    },
    successUrl: config.STRIPE_CHECKOUT_SUCCESS_URL ?? config.STRIPE_SUCCESS_URL,
    cancelUrl: config.STRIPE_CHECKOUT_CANCEL_URL ?? config.STRIPE_CANCEL_URL,
  });
  // #40/#23: config.IAP_APPLE_BUNDLE_ID / IAP_APPLE_ENVIRONMENT / APPLE_ROOT_CA_PEM を IapAdapter に
  // 配線する。未設定時は IapAdapter がチェーン内署名リンクの整合性のみ検証し、bundleId/
  // environment/ルート証明書の突合はスキップする (packages/billing/src/adapters/iap-adapter.ts
  // の JSDoc 通り)。IAP_APPLE_ENVIRONMENT は env の慣習に合わせ小文字 (sandbox/production) で
  // 保持し、IapAdapterConfig が要求する大文字表記 (Sandbox/Production, Apple API のレスポンス値に
  // 合わせた表記) に変換する。
  // #23: この設定オブジェクトは StoreKit 2 クライアント JWS 検証 (iapAdapter) だけでなく、
  // billing-routes.ts の Apple Webhook (signedPayload JWS) 署名検証にも同じ基準で適用するため
  // AppContainer 経由で再利用する (container 側で 1 箇所にまとめることで二重定義を防ぐ)。
  const iapAdapterConfig: IapAdapterConfig = {
    ...(config.IAP_APPLE_BUNDLE_ID ? { bundleId: config.IAP_APPLE_BUNDLE_ID } : {}),
    ...(config.IAP_APPLE_ENVIRONMENT === "production"
      ? { environment: "Production" }
      : config.IAP_APPLE_ENVIRONMENT === "sandbox"
        ? { environment: "Sandbox" }
        : {}),
    ...(config.APPLE_ROOT_CA_PEM ? { trustedRootCertsPem: [config.APPLE_ROOT_CA_PEM] } : {}),
  };
  const iapAdapter = createIapAdapter(iapAdapterConfig);
  const externalPurchaseAdapter = createExternalPurchaseAdapter(externalPurchaseTokenRepo, {
    redirectTokenTtlMinutes: 5,
    externalSuccessUrl: config.STOREKIT_EXTERNAL_REPORT_URL ?? "trancall://billing/external-success",
    ...(config.STOREKIT_EXTERNAL_REPORT_URL
      ? { appleExternalPurchaseApiUrl: config.STOREKIT_EXTERNAL_REPORT_URL }
      : {}),
  });
  // #29: eventBus を渡すことで publishSubscriptionUpgraded / publishSubscriptionCanceled が
  // console.log フォールバックではなく実際の EventBus 経由で publish されるようになる。
  const billing = createBillingFacade({
    subscriptionRepo,
    usageRepo,
    reservationRepo,
    webhookEventRepo,
    externalPurchaseTokenRepo,
    stripeAdapter,
    appleIapAdapter,
    googlePlayAdapter,
    stripeWebCheckoutAdapter,
    iapAdapter,
    externalPurchaseAdapter,
    eventBus,
  });

  // #46: translation.ended を購読して billing.recordUsage (+ reconcile) を呼ぶ。
  // packages/billing/CLAUDE.md 「購読するドメインイベント: translation.ended」の実装。
  // 設計判断の詳細は adapters/usage-metering-subscriber.ts 先頭のコメント参照。
  registerUsageMeteringSubscriber(eventBus, {
    billing,
    auth,
    roomReservationSessionRepo,
  });

  // contact
  const contactService = createContactService(contactRepo, blockRepo);
  const blockService = createBlockService(blockRepo);
  const searchService = createSearchService(profileSearchRepo, blockRepo);
  const reportService = createReportService(reportRepo);
  // Issue #72.3: 招待リンクのベース URL をハードコードせず config.ts (環境変数
  // INVITE_BASE_URL) から注入する
  const inviteService = createInviteService(inviteRepo, contactRepo, {
    baseUrl: config.INVITE_BASE_URL,
  });
  const contact = createContactFacade(
    contactService,
    blockService,
    searchService,
    reportService,
    inviteService,
  );

  // notification
  const apnsAdapter = buildApnsAdapter(config);
  const fcmAdapter = buildFcmAdapter(config);
  const tokenService = createDeviceTokenService(deviceTokenRepo);
  const dispatcher = createPushDispatcher({
    apnsAdapter,
    fcmAdapter,
    tokenRepo: deviceTokenRepo,
    logRepo: pushLogRepo,
    hmacSecret: config.TRANCALL_PUSH_HMAC_SECRET,
  });
  const notification = createNotificationFacade({ tokenService, dispatcher });

  // transcript (legalDocRepo を注入して termsVersion / privacyVersion を DB から取得)
  // docs/legal-and-consent.md §5.3 / docs/transcript-export-spec.md §7.3
  const transcript = createTranscriptFacade(segmentRepo, accessRepo, undefined, legalDocRepo);

  // translation
  const translation = createTranslationFacade({ sessionRepo, metricsRepo });

  // room (billing + media + notification + eventBus + blockListRepo に依存)
  const room = createRoomFacade({
    roomRepo,
    participantRepo,
    billing,
    media,
    notification,
    eventBus,
    blockListRepo: roomBlockListRepo,
  });

  // Issue #69 (2): room.participant_joined を購読して transcript_access を自動付与する。
  // packages/transcript には「アクセス権を作成する」呼び出しがどこにも存在しなかった
  // (Issue #69 調査で判明)。設計判断の詳細は adapters/transcript-access-subscriber.ts
  // 先頭のコメント参照。
  registerTranscriptAccessSubscriber(eventBus, {
    transcript,
    room,
    legalDocRepo,
  });

  return {
    supabase,
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
  };
}
