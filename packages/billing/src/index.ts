/**
 * @trancall/billing — Public API
 *
 * 外部に公開するのは Facade インターフェース / ファクトリ関数 / schemas のみ。
 * services / repositories / adapters の内部実装は直接公開しない。
 */

// Facade（唯一の外部エントリポイント）
export { createBillingFacade } from "./facade.js";
export type { BillingFacade, BillingFacadeDeps } from "./facade.js";

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
export type {
  ExternalPurchaseTokenRepository,
  ExternalPurchaseTokenRow,
} from "./repositories/external-purchase-token-repository.js";
export { createSupabaseExternalPurchaseTokenRepository } from "./repositories/external-purchase-token-repository.js";

// View Models（BillingFacade 拡張メソッドの入出力型 / UI 状態型）
export {
  PlanComparisonViewSchema,
  UpgradePreviewSchema,
  CheckoutSessionViewModelSchema,
  IapTransactionResultSchema,
  StoreKitExternalRedirectResultSchema,
  BillingScreenStateSchema,
  BillingErrorViewModelSchema,
  PreCallCostEstimateSchema,
  BillingSubscriptionUpgradedEventSchema,
  BillingSubscriptionCanceledEventSchema,
  BillingDomainEventSchema,
  initialBillingScreenState,
} from "./view-models/index.js";
export type {
  PlanComparisonView,
  UpgradePreview,
  CheckoutSessionViewModel,
  IapTransactionResult,
  StoreKitExternalRedirectResult,
  BillingScreenState,
  BillingErrorViewModel,
  AppErrorCode,
  BillingErrorMap,
  PreCallCostEstimate,
  BillingSubscriptionUpgradedEvent,
  BillingSubscriptionCanceledEvent,
  BillingDomainEvent,
} from "./view-models/index.js";

// View Models（BillingFacade 拡張メソッドの入出力型 / UI 状態型）
export {
  PlanComparisonViewSchema,
  UpgradePreviewSchema,
  CheckoutSessionViewModelSchema,
  IapTransactionResultSchema,
  StoreKitExternalRedirectResultSchema,
  BillingScreenStateSchema,
  BillingErrorViewModelSchema,
  PreCallCostEstimateSchema,
  BillingSubscriptionUpgradedEventSchema,
  BillingSubscriptionCanceledEventSchema,
  BillingDomainEventSchema,
  initialBillingScreenState,
} from "./view-models/index.js";
export type {
  PlanComparisonView,
  UpgradePreview,
  CheckoutSessionViewModel,
  IapTransactionResult,
  StoreKitExternalRedirectResult,
  BillingScreenState,
  BillingErrorViewModel,
  AppErrorCode,
  BillingErrorMap,
  PreCallCostEstimate,
  BillingSubscriptionUpgradedEvent,
  BillingSubscriptionCanceledEvent,
  BillingDomainEvent,
} from "./view-models/index.js";

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

export {
  createStripeWebCheckoutAdapter,
} from "./adapters/stripe-web-checkout-adapter.js";
export type {
  StripeWebCheckoutAdapter,
  StripeWebCheckoutConfig,
} from "./adapters/stripe-web-checkout-adapter.js";

export {
  createIapAdapter,
  APPLE_IAP_PRODUCT_ID_MAP,
} from "./adapters/iap-adapter.js";
export type {
  IapAdapter,
  VerifiedIapTransaction,
} from "./adapters/iap-adapter.js";

export {
  createExternalPurchaseAdapter,
} from "./adapters/external-purchase-adapter.js";
export type {
  ExternalPurchaseAdapter,
  ExternalPurchaseAdapterConfig,
} from "./adapters/external-purchase-adapter.js";

// DomainEvent ヘルパー
export type { EventBus } from "./events.js";
export {
  publishSubscriptionUpgraded,
  publishSubscriptionCanceled,
} from "./events.js";
