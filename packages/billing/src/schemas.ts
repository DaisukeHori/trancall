/**
 * @trancall/billing — Zodスキーマ定義
 *
 * shared-kernel の基本型を拡張し、billing モジュール固有のスキーマを定義する。
 * PlanConfig / SubscriptionState / UsageWindow / RecordUsageCommand は
 * docs/schemas.ts (v11) の billing セクションに準拠。
 */

import { z } from "zod";
import {
  UserIdSchema,
  RoomIdSchema,
  TranslationSessionIdSchema,
} from "@trancall/shared-kernel";

// =============================================================================
// プランティア
// =============================================================================

export const PlanTier = z.enum(["free", "light", "standard", "business"]);
export type PlanTier = z.infer<typeof PlanTier>;

// =============================================================================
// 購入チャネル
// =============================================================================

export const PurchaseChannel = z.enum([
  "free",
  "iap_apple",
  "iap_google",
  "storekit_external",
  "stripe_web",
]);
export type PurchaseChannel = z.infer<typeof PurchaseChannel>;

// =============================================================================
// プラン設定
// m-009: Free プラン = 5分
// =============================================================================

export const PlanConfig = z.object({
  tier: PlanTier,
  includedMinutes: z.number().int().nonnegative(),
  overageRateYen: z.number().int().nonnegative(),
  monthlyPriceYen: z.number().int().nonnegative(),
  transcriptRetentionDays: z.number().int().positive(),
});
export type PlanConfig = z.infer<typeof PlanConfig>;

// プランの定義値 (canonical)
export const PLAN_CONFIGS: Record<PlanTier, PlanConfig> = {
  free: {
    tier: "free",
    includedMinutes: 5,
    overageRateYen: 0,
    monthlyPriceYen: 0,
    transcriptRetentionDays: 7,
  },
  light: {
    tier: "light",
    includedMinutes: 30,
    overageRateYen: 40,
    monthlyPriceYen: 980,
    transcriptRetentionDays: 30,
  },
  standard: {
    tier: "standard",
    includedMinutes: 120,
    overageRateYen: 30,
    monthlyPriceYen: 2980,
    transcriptRetentionDays: 90,
  },
  business: {
    tier: "business",
    includedMinutes: 500,
    overageRateYen: 25,
    monthlyPriceYen: 9800,
    transcriptRetentionDays: 365,
  },
};

// =============================================================================
// サブスクリプション状態
// =============================================================================

export const SubscriptionState = z.object({
  userId: UserIdSchema,
  plan: PlanConfig,
  currentPeriodStart: z.iso.datetime(),
  currentPeriodEnd: z.iso.datetime(),
  usedMinutes: z.number().nonnegative(),
  remainingMinutes: z.number().nonnegative(),
  cancelAtPeriodEnd: z.boolean(),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  iapOriginalTransactionId: z.string().nullable(),
  iapPlatform: z.enum(["apple", "google"]).nullable(),
});
export type SubscriptionState = z.infer<typeof SubscriptionState>;

// =============================================================================
// 利用量ウィンドウ（heartbeat 方式）
// =============================================================================

export const UsageWindow = z.object({
  id: z.uuid(),
  userId: UserIdSchema,
  sessionId: TranslationSessionIdSchema,
  roomId: RoomIdSchema,
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  durationSeconds: z.number().int().nonnegative(),
  languagePair: z.string(),
  amountYen: z.number().int().nonnegative(),
  idempotencyKey: z.string(),
  recordedAt: z.iso.datetime(),
});
export type UsageWindow = z.infer<typeof UsageWindow>;

// =============================================================================
// 利用量記録コマンド（heartbeat 受信）
// =============================================================================

export const RecordUsageCommand = z.object({
  userId: UserIdSchema,
  sessionId: TranslationSessionIdSchema,
  roomId: RoomIdSchema,
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  durationSeconds: z.number().nonnegative(),
  languagePair: z.string(),
  idempotencyKey: z.string(),
});
export type RecordUsageCommand = z.infer<typeof RecordUsageCommand>;

// =============================================================================
// 予約
// =============================================================================

export const UsageReservation = z.object({
  id: z.uuid(),
  userId: UserIdSchema,
  sessionId: TranslationSessionIdSchema,
  reservedMinutes: z.number().int().positive(),
  consumedMinutes: z.number().int().nonnegative(),
  status: z.enum(["active", "reconciled", "expired"]),
  createdAt: z.iso.datetime(),
  reconciledAt: z.iso.datetime().nullable(),
});
export type UsageReservation = z.infer<typeof UsageReservation>;

// =============================================================================
// Webhook イベント
// =============================================================================

export const WebhookProvider = z.enum([
  "stripe",
  "apple_iap",
  "google_play",
  "storekit_external",
]);
export type WebhookProvider = z.infer<typeof WebhookProvider>;

export const WebhookEvent = z.object({
  id: z.uuid(),
  provider: WebhookProvider,
  externalEventId: z.string(),
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  processedAt: z.iso.datetime().nullable(),
  processingError: z.string().nullable(),
  receivedAt: z.iso.datetime(),
});
export type WebhookEvent = z.infer<typeof WebhookEvent>;

// =============================================================================
// [Sprint 2 D5 拡張] PlanComparisonView — プラン一覧表示用ビューモデル
// =============================================================================

export const PlanComparisonViewSchema = z.object({
  currentTier: PlanTier,
  plans: z.array(
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
    })
  ).length(4),
});
export type PlanComparisonView = z.infer<typeof PlanComparisonViewSchema>;

// =============================================================================
// [Sprint 2 D5 拡張] UpgradePreview — アップグレード日割りプレビュー
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
// [Sprint 2 D5 拡張] IapTransactionResult — StoreKit 2 トランザクション
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
// [Sprint 2 D5 拡張] StoreKitExternalRedirectResult — External Purchase コールバック
// =============================================================================

export const StoreKitExternalRedirectResultSchema = z.object({
  redirectToken: z.string(),
  stripeSubscriptionId: z.string(),
  completedAt: z.iso.datetime(),
});
export type StoreKitExternalRedirectResult = z.infer<typeof StoreKitExternalRedirectResultSchema>;

// =============================================================================
// [Sprint 2 D5 拡張] ExternalPurchaseToken — redirectToken 管理 DB 行型
// =============================================================================

export const ExternalPurchaseTokenRow = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  token: z.string(),
  target_tier: PlanTier,
  stripe_session_id: z.string(),
  expires_at: z.string(),
  used: z.boolean(),
  created_at: z.string(),
});
export type ExternalPurchaseTokenRow = z.infer<typeof ExternalPurchaseTokenRow>;

// =============================================================================
// チェックアウトセッション作成コマンド
// =============================================================================

export const CreateCheckoutSessionCommand = z.object({
  userId: UserIdSchema,
  tier: PlanTier,
  channel: z.enum(["stripe_web", "storekit_external"]),
  successUrl: z.url().optional(),
  cancelUrl: z.url().optional(),
});
export type CreateCheckoutSessionCommand = z.infer<
  typeof CreateCheckoutSessionCommand
>;

// =============================================================================
// DB 行型 (Repository 入出力用)
// =============================================================================

export const SubscriptionRow = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  plan_tier: PlanTier,
  included_minutes: z.number().int(),
  overage_rate_yen: z.number().int(),
  monthly_price_yen: z.number().int(),
  transcript_retention_days: z.number().int(),
  cancel_at_period_end: z.boolean(),
  purchase_channel: PurchaseChannel,
  stripe_customer_id: z.string().nullable(),
  stripe_subscription_id: z.string().nullable(),
  iap_original_transaction_id: z.string().nullable(),
  current_period_start: z.string(),
  current_period_end: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SubscriptionRow = z.infer<typeof SubscriptionRow>;
