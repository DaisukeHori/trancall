/**
 * @trancall/billing — Public API
 *
 * 外部に公開するのは Facade インターフェース / ファクトリ関数 / schemas のみ。
 * services / repositories / adapters の内部実装は直接公開しない。
 */

// Facade（唯一の外部エントリポイント）
export { createBillingFacade } from "./facade.js";
export type {
  BillingFacade,
  BillingFacadeDeps,
  IapTransactionResult,
  StoreKitExternalRedirectResult,
  PlanComparisonView,
  UpgradePreview,
} from "./facade.js";

// Schemas（モジュール境界の契約）
export {
  PlanTier,
  PurchaseChannel,
  PlanConfig,
  PLAN_CONFIGS,
  SubscriptionState,
  UsageWindow,
  RecordUsageCommand,
  UsageReservation,
  WebhookProvider,
  WebhookEvent,
  CreateCheckoutSessionCommand,
  SubscriptionRow,
} from "./schemas.js";
export type {
  PlanTier as PlanTierType,
  PurchaseChannel as PurchaseChannelType,
  PlanConfig as PlanConfigType,
  SubscriptionState as SubscriptionStateType,
  UsageWindow as UsageWindowType,
  RecordUsageCommand as RecordUsageCommandType,
  UsageReservation as UsageReservationType,
  WebhookProvider as WebhookProviderType,
  WebhookEvent as WebhookEventType,
  CreateCheckoutSessionCommand as CreateCheckoutSessionCommandType,
  SubscriptionRow as SubscriptionRowType,
} from "./schemas.js";

// Repository interfaces（apps/server 側での実装用）
export type { SubscriptionRepository } from "./repositories/subscription-repository.js";
export type { UsageRepository } from "./repositories/usage-repository.js";
export type { ReservationRepository } from "./repositories/reservation-repository.js";
export type { WebhookEventRepository } from "./repositories/webhook-event-repository.js";

// Adapter factories（apps/server 側での注入用）
export {
  createStripeAdapter,
} from "./adapters/stripe-adapter.js";
export type {
  StripeAdapter,
  StripeAdapterConfig,
  StripePriceIds,
} from "./adapters/stripe-adapter.js";

export {
  createAppleIapAdapter,
  APPLE_PRODUCT_ID_MAP,
} from "./adapters/apple-iap-adapter.js";
export type {
  AppleIapAdapter,
  AppleIapWebhookResult,
} from "./adapters/apple-iap-adapter.js";

export {
  createGooglePlayAdapter,
  GOOGLE_PRODUCT_ID_MAP,
} from "./adapters/google-play-adapter.js";
export type {
  GooglePlayAdapter,
  GooglePlayWebhookResult,
} from "./adapters/google-play-adapter.js";
