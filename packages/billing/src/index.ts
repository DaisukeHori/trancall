/**
 * @trancall/billing — Public API
 *
 * 外部に公開するのは Facade インターフェース / ファクトリ関数 / schemas のみ。
 * services / repositories / adapters の内部実装は直接公開しない。
 */

// Facade（唯一の外部エントリポイント）
export { createBillingFacade } from "./facade";
export type {
  BillingFacade,
  BillingFacadeDeps,
} from "./facade";
// IapTransactionResult / StoreKitExternalRedirectResult / PlanComparisonView / UpgradePreview は
// view-models/index.ts から canonical export される (下記参照)

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
} from "./schemas";
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
} from "./schemas";

// Repository interfaces（apps/server 側での実装用）
export type { SubscriptionRepository } from "./repositories/subscription-repository";
export type { UsageRepository } from "./repositories/usage-repository";
export type { ReservationRepository } from "./repositories/reservation-repository";
export type { WebhookEventRepository } from "./repositories/webhook-event-repository";
export type {
  ExternalPurchaseTokenRepository,
  ExternalPurchaseTokenRow,
} from "./repositories/external-purchase-token-repository";

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
} from "./view-models/index";
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
} from "./view-models/index";

// Adapter factories（apps/server 側での注入用）
export {
  createStripeAdapter,
} from "./adapters/stripe-adapter";
export type {
  StripeAdapter,
  StripeAdapterConfig,
  StripePriceIds,
} from "./adapters/stripe-adapter";

export {
  createAppleIapAdapter,
  APPLE_PRODUCT_ID_MAP,
} from "./adapters/apple-iap-adapter";
export type {
  AppleIapAdapter,
  AppleIapWebhookResult,
} from "./adapters/apple-iap-adapter";

export {
  createGooglePlayAdapter,
  GOOGLE_PRODUCT_ID_MAP,
} from "./adapters/google-play-adapter";
export type {
  GooglePlayAdapter,
  GooglePlayWebhookResult,
} from "./adapters/google-play-adapter";

export {
  createStripeWebCheckoutAdapter,
} from "./adapters/stripe-web-checkout-adapter";
export type {
  StripeWebCheckoutAdapter,
  StripeWebCheckoutConfig,
} from "./adapters/stripe-web-checkout-adapter";

export {
  createIapAdapter,
  APPLE_IAP_PRODUCT_ID_MAP,
  // #23: apps/server の Apple Webhook (signedPayload JWS) 署名検証で再利用するため export
  verifyJwsSignature,
} from "./adapters/iap-adapter";
export type {
  IapAdapter,
  IapAdapterConfig,
  VerifiedIapTransaction,
} from "./adapters/iap-adapter";

export {
  createExternalPurchaseAdapter,
} from "./adapters/external-purchase-adapter";
export type {
  ExternalPurchaseAdapter,
  ExternalPurchaseAdapterConfig,
} from "./adapters/external-purchase-adapter";

// DomainEvent ヘルパー
export type { EventBus } from "./events";
export {
  publishSubscriptionUpgraded,
  publishSubscriptionCanceled,
} from "./events";
