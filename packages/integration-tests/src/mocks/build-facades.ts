/**
 * 全 Facade を in-memory mock で組み立てる Factory
 *
 * テスト側は buildFacades() を呼ぶだけで使える。
 */

import { createAuthFacade } from "@trancall/auth";
import type { AuthFacade } from "@trancall/auth";
import type { Profile } from "@trancall/auth";
import type { AuthEventBus } from "@trancall/auth";

import { createMediaFacade, createLiveKitAdapter } from "@trancall/media";
import type { MediaFacade } from "@trancall/media";

import { createBillingFacade } from "@trancall/billing";
import type { BillingFacade } from "@trancall/billing";
import type { SubscriptionRow } from "@trancall/billing";

import {
  createContactFacade,
  createContactService,
  createBlockService,
  createSearchService,
  createReportService,
  createInviteService,
} from "@trancall/contact";
import type { ContactFacade } from "@trancall/contact";
import type { PublicProfile } from "@trancall/contact";

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

import {
  makeProfileRepository,
  makeConsentRepository,
  makeLegalDocVersionRepository,
  makeExternalPurchaseTokenRepository,
  makeSubscriptionRepository,
  makeUsageRepository,
  makeReservationRepository,
  makeWebhookEventRepository,
  makeContactRepository,
  makeBlockRepository,
  makeProfileSearchRepository,
  makeInviteRepository,
  makeReportRepository,
  makeDeviceTokenRepository,
  makePushLogRepository,
  makeSegmentRepository,
  makeAccessRepository,
  makeTranslationSessionRepository,
  makeAgentMetricsRepository,
  type InMemorySubscriptionRepo,
  type InMemoryUsageRepo,
  type InMemorySegmentRepo,
  type InMemoryAccessRepo,
  type InMemoryBlockRepo,
  type InMemoryTranslationSessionRepo,
} from "./all-repos.js";

import {
  makeApnsAdapter,
  makeFcmAdapter,
  makeStripeAdapter,
  makeAppleIapAdapter,
  makeGooglePlayAdapter,
} from "./adapters.js";

export interface Facades {
  auth: AuthFacade;
  media: MediaFacade;
  billing: BillingFacade;
  contact: ContactFacade;
  notification: NotificationFacade;
  transcript: TranscriptFacade;
  translation: TranslationFacade;
}

export interface FacadeRepos {
  subscriptionRepo: InMemorySubscriptionRepo;
  usageRepo: InMemoryUsageRepo;
  segmentRepo: InMemorySegmentRepo;
  accessRepo: InMemoryAccessRepo;
  blockRepo: InMemoryBlockRepo;
  translationSessionRepo: InMemoryTranslationSessionRepo;
  reservationRepo: ReturnType<typeof makeReservationRepository>;
}

export interface BuildFacadesOptions {
  profiles?: Profile[];
  subscriptions?: SubscriptionRow[];
  searchableProfiles?: PublicProfile[];
}

export function buildFacades(opts: BuildFacadesOptions = {}): {
  facades: Facades;
  repos: FacadeRepos;
} {
  // --- repositories ---
  const profileRepo = makeProfileRepository(opts.profiles ?? []);
  const consentRepo = makeConsentRepository();
  const legalDocRepo = makeLegalDocVersionRepository();
  const subscriptionRepo = makeSubscriptionRepository(opts.subscriptions ?? []);
  const usageRepo = makeUsageRepository();
  const reservationRepo = makeReservationRepository();
  const webhookEventRepo = makeWebhookEventRepository();
  const externalPurchaseTokenRepo = makeExternalPurchaseTokenRepository();

  const contactRepo = makeContactRepository();
  const blockRepo = makeBlockRepository();
  const profileSearchRepo = makeProfileSearchRepository(opts.searchableProfiles ?? []);
  const inviteRepo = makeInviteRepository();
  const reportRepo = makeReportRepository();

  const deviceTokenRepo = makeDeviceTokenRepository();
  const pushLogRepo = makePushLogRepository();

  const segmentRepo = makeSegmentRepository();
  const accessRepo = makeAccessRepository();

  const translationSessionRepo = makeTranslationSessionRepository();
  const agentMetricsRepo = makeAgentMetricsRepository();

  // --- adapters ---
  const apnsAdapter = makeApnsAdapter();
  const fcmAdapter = makeFcmAdapter();
  const stripeAdapter = makeStripeAdapter();
  const appleIapAdapter = makeAppleIapAdapter();
  const googlePlayAdapter = makeGooglePlayAdapter();

  // --- auth ---
  const authEventBus: AuthEventBus = {
    publish: async () => { /* no-op in tests */ },
  };
  const auth = createAuthFacade({
    profileRepo,
    consentRepo,
    legalDocRepo,
    eventBus: authEventBus,
  });

  // --- media (LiveKit adapter wraps AuthFacade for profile lookup) ---
  const liveKitAdapter = createLiveKitAdapter({
    livekitUrl: "wss://mock.livekit.cloud",
    livekitHttpUrl: "https://mock.livekit.cloud",
    apiKey: "mock-api-key",
    apiSecret: "mock-api-secret-0123456789012345",
    authFacade: auth,
  });
  const media = createMediaFacade(liveKitAdapter);

  // --- billing ---
  const billing = createBillingFacade({
    subscriptionRepo,
    usageRepo,
    reservationRepo,
    webhookEventRepo,
    externalPurchaseTokenRepo,
    stripeAdapter,
    appleIapAdapter,
    googlePlayAdapter,
  });

  // --- contact ---
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

  // --- notification ---
  const tokenService = createDeviceTokenService(deviceTokenRepo);
  const dispatcher = createPushDispatcher({
    apnsAdapter,
    fcmAdapter,
    tokenRepo: deviceTokenRepo,
    logRepo: pushLogRepo,
    hmacSecret: "0".repeat(64), // テスト用 HMAC secret (64 hex chars)
    delayFn: async () => { /* no delay in tests */ },
  });
  const notification = createNotificationFacade({ tokenService, dispatcher });

  // --- transcript ---
  const transcript = createTranscriptFacade(segmentRepo, accessRepo);

  // --- translation ---
  const translation = createTranslationFacade({
    sessionRepo: translationSessionRepo,
    metricsRepo: agentMetricsRepo,
  });

  return {
    facades: { auth, media, billing, contact, notification, transcript, translation },
    repos: { subscriptionRepo, usageRepo, segmentRepo, accessRepo, blockRepo, translationSessionRepo, reservationRepo },
  };
}
