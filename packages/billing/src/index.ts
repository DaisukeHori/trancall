/**
 * @trancall/billing — Public API
 *
 * 外部に公開するのは Facade インターフェース / ファクトリ関数 / schemas のみ。
 * services / repositories / adapters の内部実装は直接公開しない。
 */

// Facade（唯一の外部エントリポイント）
export { createBillingFacade } from "./facade.ts";
export type {
  BillingFacade,
  BillingFacadeDeps,
} from "./facade.ts";
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
} from "./schemas.ts";
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
} from "./schemas.ts";

// Repository interfaces（apps/server 側での実装用）
export type { SubscriptionRepository } from "./repositories/subscription-repository.ts";
export type { UsageRepository } from "./repositories/usage-repository.ts";
export type { ReservationRepository } from "./repositories/reservation-repository.ts";
export type { WebhookEventRepository } from "./repositories/webhook-event-repository.ts";
export type {
  ExternalPurchaseTokenRepository,
  ExternalPurchaseTokenRow,
} from "./repositories/external-purchase-token-repository.ts";

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
  // [P-2] storekit-external/report
  StoreKitExternalReportCommandSchema,
  StoreKitExternalReportResultSchema,
} from "./view-models/index.ts";
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
  // [P-2] storekit-external/report
  StoreKitExternalReportCommand,
  StoreKitExternalReportResult,
} from "./view-models/index.ts";

// Adapter factories（apps/server 側での注入用）
export {
  createStripeAdapter,
} from "./adapters/stripe-adapter.ts";
export type {
  StripeAdapter,
  StripeAdapterConfig,
  StripePriceIds,
} from "./adapters/stripe-adapter.ts";

export {
  createAppleIapAdapter,
} from "./adapters/apple-iap-adapter.ts";
export type {
  AppleIapAdapter,
  AppleIapWebhookResult,
} from "./adapters/apple-iap-adapter.ts";

export {
  createGooglePlayAdapter,
  GOOGLE_PRODUCT_ID_MAP,
} from "./adapters/google-play-adapter.ts";
export type {
  GooglePlayAdapter,
  GooglePlayWebhookResult,
} from "./adapters/google-play-adapter.ts";

export {
  createStripeWebCheckoutAdapter,
} from "./adapters/stripe-web-checkout-adapter.ts";
export type {
  StripeWebCheckoutAdapter,
  StripeWebCheckoutConfig,
} from "./adapters/stripe-web-checkout-adapter.ts";

export {
  createIapAdapter,
  APPLE_IAP_PRODUCT_ID_MAP,
  // #23: apps/server の Apple Webhook (signedPayload JWS) 署名検証で再利用するため export
  verifyJwsSignature,
} from "./adapters/iap-adapter.ts";
export type {
  IapAdapter,
  IapAdapterConfig,
  VerifiedIapTransaction,
} from "./adapters/iap-adapter.ts";

export {
  createExternalPurchaseAdapter,
} from "./adapters/external-purchase-adapter.ts";
export type {
  ExternalPurchaseAdapter,
  ExternalPurchaseAdapterConfig,
} from "./adapters/external-purchase-adapter.ts";

// DomainEvent ヘルパー
export type { EventBus } from "./events.ts";
export {
  publishSubscriptionUpgraded,
  publishSubscriptionCanceled,
} from "./events.ts";
