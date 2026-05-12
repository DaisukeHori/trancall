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
import type { AuthFacade } from "@trancall/auth";
import {
  createBillingFacade,
  createStripeWebCheckoutAdapter,
  createIapAdapter,
  createExternalPurchaseAdapter,
} from "@trancall/billing";
import type { BillingFacade } from "@trancall/billing";
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
import { createConsentRepository } from "./adapters/repositories/auth/consent-repository.supabase.js";
import { createLegalDocVersionRepository } from "./adapters/repositories/auth/legal-doc-version-repository.supabase.js";
// Repositories — billing
import { createSubscriptionRepository } from "./adapters/repositories/billing/subscription-repository.supabase.js";
import { createUsageRepository } from "./adapters/repositories/billing/usage-repository.supabase.js";
import { createReservationRepository } from "./adapters/repositories/billing/reservation-repository.supabase.js";
import { createWebhookEventRepository } from "./adapters/repositories/billing/webhook-event-repository.supabase.js";
import { createExternalPurchaseTokenRepository } from "./adapters/repositories/billing/external-purchase-token-repository.supabase.js";
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

// Adapters
import { buildLiveKitAdapter } from "./adapters/livekit-adapter.js";
import { buildStripeAdapter } from "./adapters/stripe-adapter.js";
import { buildAppleIapAdapter, buildGooglePlayAdapter } from "./adapters/iap-adapters.js";
import { buildApnsAdapter, buildFcmAdapter } from "./adapters/notification-adapters.js";

// EventBus
import { createEventBus } from "./adapters/event-bus.js";
import type { EventBus } from "./adapters/event-bus.js";

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
  const consentRepo = createConsentRepository(supabase);
  const legalDocRepo = createLegalDocVersionRepository(supabase);
  // billing
  const subscriptionRepo = createSubscriptionRepository(supabase);
  const usageRepo = createUsageRepository(supabase);
  const reservationRepo = createReservationRepository(supabase);
  const webhookEventRepo = createWebhookEventRepository(supabase);
  const externalPurchaseTokenRepo = createExternalPurchaseTokenRepository(supabase);
  // contact
  const contactRepo = createContactRepository(supabase);
  const blockRepo = createBlockRepository(supabase);
  const inviteRepo = createInviteRepository(supabase);
  const profileSearchRepo = createProfileSearchRepository(supabase);
  const reportRepo = createReportRepository(supabase);
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
  const authEventBus = {
    publish: async (event: { type: string; payload?: unknown }): Promise<void> => {
      if (
        event.type === "auth.consent_recorded" ||
        event.type === "auth.consent_revoked"
      ) {
        // DomainEvent union に auth イベントを追加済みのため publish 可能
        await eventBus.publish(
          event as Parameters<typeof eventBus.publish>[0],
        );
      }
    },
  };
  const auth = createAuthFacade({
    profileRepo,
    consentRepo,
    legalDocRepo,
    eventBus: authEventBus,
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
  const iapAdapter = createIapAdapter();
  const externalPurchaseAdapter = createExternalPurchaseAdapter(externalPurchaseTokenRepo, {
    redirectTokenTtlMinutes: 5,
    externalSuccessUrl: config.STOREKIT_EXTERNAL_REPORT_URL ?? "trancall://billing/external-success",
    ...(config.STOREKIT_EXTERNAL_REPORT_URL
      ? { appleExternalPurchaseApiUrl: config.STOREKIT_EXTERNAL_REPORT_URL }
      : {}),
  });
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
  });

  // contact
  const contactService = createContactService(contactRepo, blockRepo);
  const blockService = createBlockService(blockRepo);
  const searchService = createSearchService(profileSearchRepo, blockRepo);
  const reportService = createReportService(reportRepo);
  const inviteService = createInviteService(inviteRepo, contactRepo);
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

  // transcript
  const transcript = createTranscriptFacade(segmentRepo, accessRepo);

  // translation
  const translation = createTranslationFacade({ sessionRepo, metricsRepo });

  // room (billing + media + notification + eventBus に依存)
  const room = createRoomFacade({
    roomRepo,
    participantRepo,
    billing,
    media,
    notification,
    eventBus,
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
  };
}
