/**
 * @trancall/billing/client — クライアント安全な Public API サブセット
 *
 * `./index.ts` (root barrel) は apps/server 向けに Facade / Repository interface /
 * Adapter factories (Stripe SDK, Apple/Google IAP の crypto 使用等) を含む全てを
 * 単一ファイルで re-export している。Metro はモノレポ全体のモジュールグラフを
 * 静的に辿ってバンドルするため、apps/mobile が root barrel から何か1つでも
 * import すると、Stripe Node SDK (`child_process`/`fs`/`http`/`https`/`net`/`tls`
 * 等、Node.js専用の多数のコアモジュールに依存) や Apple/Google IAP アダプター
 * (Node.js `crypto` の X509Certificate/verify) までバンドル対象に含まれ、
 * React Native (Hermes) には存在しないモジュールとして解決に失敗する
 * (PR #75 CI実測: "Unable to resolve module child_process from
 * node_modules/stripe/.../NodePlatformFunctions.js")。
 *
 * apps/mobile が実際に使うのは schemas (プラン/購読状態等の値オブジェクト) と
 * view-models (BillingFacade 拡張メソッドの入出力型/UI状態型) のみで、
 * Facade 本体 (createBillingFacade)・Repository interface・Adapter factories は
 * 一切使わない (grep で確認済み)。このファイルはその安全なサブセットのみを
 * 公開し、apps/mobile はここから import することで Stripe SDK 等の
 * server-only 依存をバンドルグラフに含めない。
 *
 * apps/server は引き続き `./index.ts` (root barrel) から Facade/Adapter を
 * import する。
 */

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
} from "./view-models/index.ts";
