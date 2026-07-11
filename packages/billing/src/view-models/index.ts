/**
 * @trancall/billing — View Model Zod スキーマ定義
 *
 * docs/billing-ui-flow.md v1.2 §4 canonical 定義に準拠。
 * docs/module-contracts.md §2.3 BillingFacade メソッドシグネチャと対応。
 */

import { z } from "zod";
import { UserIdSchema } from "@trancall/shared-kernel";
import { DomainEventBase } from "@trancall/shared-kernel";
import {
  PlanTier,
  PurchaseChannel,
  SubscriptionState,
} from "../schemas.ts";

// =============================================================================
// 4.1 PlanComparisonView
// Settings → Subscription 画面でプラン一覧を表示するビューモデル
// =============================================================================

export const PlanComparisonViewSchema = z.object({
  currentTier: PlanTier,
  plans: z
    .array(
      z.object({
        tier: PlanTier,
        name: z.string(),
        monthlyPriceYen: z.number().int().nonnegative(),
        includedMinutes: z.number().int().nonnegative(),
        overageRateYen: z.number().int().nonnegative(),
        transcriptRetentionDays: z.number().int().positive(),
        features: z.array(z.string()),
        isRecommended: z.boolean(),
        isCurrent: z.boolean(),
      }),
    )
    .length(4), // free/light/standard/business 固定 4 件
});
export type PlanComparisonView = z.infer<typeof PlanComparisonViewSchema>;

// =============================================================================
// 4.2 UpgradePreview
// 現在プランから目標プランへの upgrade preview (日割り計算結果)
// =============================================================================

export const UpgradePreviewSchema = z.object({
  currentTier: PlanTier,
  targetTier: PlanTier,
  proratedAmountYen: z.number().int().nonnegative(),
  nextBillingDate: z.iso.datetime(),
  effectiveImmediately: z.boolean(),
  confirmationRequired: z.boolean(),
});
export type UpgradePreview = z.infer<typeof UpgradePreviewSchema>;

// =============================================================================
// 4.3 CheckoutSessionViewModel
// Stripe Web Checkout 表示用 ViewModel
// =============================================================================

export const CheckoutSessionViewModelSchema = z.object({
  checkoutUrl: z.url(),
  sessionId: z.string(),
  expiresAt: z.iso.datetime(),
  targetTier: PlanTier,
  returnUrl: z.string(),
});
export type CheckoutSessionViewModel = z.infer<
  typeof CheckoutSessionViewModelSchema
>;

// =============================================================================
// 4.4 IapTransactionResult (StoreKit 2)
// iOS StoreKit 2 の Transaction から取り出す情報
// =============================================================================

export const IapTransactionResultSchema = z.object({
  originalTransactionId: z.string(),
  productId: z.string(),
  purchaseDate: z.iso.datetime(),
  expirationDate: z.iso.datetime().nullable(),
  signedJws: z.string(),
  isUpgrade: z.boolean(),
});
export type IapTransactionResult = z.infer<typeof IapTransactionResultSchema>;

// =============================================================================
// 4.5 StoreKitExternalRedirectResult
// External Purchase 完了後のコールバック deep link からパースする情報
// =============================================================================

export const StoreKitExternalRedirectResultSchema = z.object({
  redirectToken: z.string(),
  stripeSubscriptionId: z.string(),
  completedAt: z.iso.datetime(),
});
export type StoreKitExternalRedirectResult = z.infer<
  typeof StoreKitExternalRedirectResultSchema
>;

// =============================================================================
// 4.6 BillingScreenState
// Settings → Subscription 画面の全状態 (billingStore / Zustand 用)
// =============================================================================

export const BillingScreenStateSchema = z.object({
  subscriptionState: SubscriptionState.nullable(),
  planComparison: PlanComparisonViewSchema.nullable(),
  pendingTransaction: z
    .object({
      channel: z.enum(["iap_apple", "storekit_external", "stripe_web"]),
      targetTier: PlanTier,
      startedAt: z.iso.datetime(),
    })
    .nullable(),
  lastError: z
    .object({
      code: z.string(),
      title: z.string(),
      message: z.string(),
      actionLabel: z.string(),
      retryable: z.boolean(),
    })
    .nullable(),
  isRestoring: z.boolean(),
  checkoutSession: CheckoutSessionViewModelSchema.nullable(),
});
export type BillingScreenState = z.infer<typeof BillingScreenStateSchema>;

/** 初期値 */
export const initialBillingScreenState: BillingScreenState = {
  subscriptionState: null,
  planComparison: null,
  pendingTransaction: null,
  lastError: null,
  isRestoring: false,
  checkoutSession: null,
};

// =============================================================================
// 4.7 BillingErrorViewModel
// AppError から UI 表示用ビューモデルに変換するマッピング型
// =============================================================================

export const BillingErrorViewModelSchema = z.object({
  code: z.string(),
  title: z.string(),
  message: z.string(),
  actionLabel: z.string(),
  retryable: z.boolean(),
});
export type BillingErrorViewModel = z.infer<typeof BillingErrorViewModelSchema>;

export type AppErrorCode = string;
export type BillingErrorMap = Map<
  AppErrorCode,
  Omit<BillingErrorViewModel, "code">
>;

// =============================================================================
// 4.8 Billing*Event — DomainEvent 2 種
// billing モジュールが発行する DomainEvent
// =============================================================================

export const BillingSubscriptionUpgradedEventSchema = DomainEventBase.extend({
  type: z.literal("billing.subscription_upgraded"),
  payload: z.object({
    userId: UserIdSchema,
    fromTier: PlanTier,
    toTier: PlanTier,
    channel: PurchaseChannel,
    effectiveAt: z.iso.datetime(),
  }),
});
export type BillingSubscriptionUpgradedEvent = z.infer<
  typeof BillingSubscriptionUpgradedEventSchema
>;

export const BillingSubscriptionCanceledEventSchema = DomainEventBase.extend({
  type: z.literal("billing.subscription_canceled"),
  payload: z.object({
    userId: UserIdSchema,
    fromTier: PlanTier,
    channel: PurchaseChannel,
    cancelAtPeriodEnd: z.boolean(),
    effectiveAt: z.iso.datetime(),
  }),
});
export type BillingSubscriptionCanceledEvent = z.infer<
  typeof BillingSubscriptionCanceledEventSchema
>;

/** Billing*Event の discriminated union */
export const BillingDomainEventSchema = z.discriminatedUnion("type", [
  BillingSubscriptionUpgradedEventSchema,
  BillingSubscriptionCanceledEventSchema,
]);
export type BillingDomainEvent = z.infer<typeof BillingDomainEventSchema>;

// =============================================================================
// 4.9 PreCallCostEstimate
// Pre-call 画面で通話前コスト見積を表示するビューモデル
// =============================================================================

export const PreCallCostEstimateSchema = z.object({
  expectedMinutes: z.number().int().positive(),
  remainingMinutes: z.number().nonnegative(),
  predictedCostYen: z.number().int().nonnegative(),
  willExceedQuota: z.boolean(),
  recommendedAction: z.enum(["proceed", "upgrade", "warn_overage"]),
});
export type PreCallCostEstimate = z.infer<typeof PreCallCostEstimateSchema>;

// =============================================================================
// 4.10 [P-2] StoreKitExternalReport — Apple StoreKit External Purchase 月次レポート受付
// docs/api-spec.md 「POST /api/billing/storekit-external/report」canonical 準拠。
// =============================================================================

export const StoreKitExternalReportCommandSchema = z.object({
  /**
   * ExternalPurchaseAdapter が発行した redirectToken
   * (`generateRedirectToken()` / `ExternalPurchaseTokenRow.token`)。
   * Apple External Purchase Server API 向けの取引識別子として再利用する。
   */
  externalPurchaseToken: z.string().min(1),
  stripeSessionId: z.string().min(1),
  amountYen: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime(),
});
export type StoreKitExternalReportCommand = z.infer<
  typeof StoreKitExternalReportCommandSchema
>;

export const StoreKitExternalReportResultSchema = z.object({
  queuedForAppleReport: z.literal(true),
});
export type StoreKitExternalReportResult = z.infer<
  typeof StoreKitExternalReportResultSchema
>;
