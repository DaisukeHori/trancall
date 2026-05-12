/**
 * BillingFacade — billing モジュールの唯一の外部エントリポイント
 *
 * docs/schemas.ts の BillingFacade インターフェースに準拠し、拡張メソッドを追加。
 * DI でリポジトリ・アダプタを受け取り、サービス層に委譲する。
 */

import { z } from "zod";
import {
  type Result,
  type UserId,
  type TranslationSessionId,
  ok,
  err,
  validate,
  brandUserId,
} from "@trancall/shared-kernel";

import { randomBytes } from "node:crypto";

import type {
  SubscriptionState,
  RecordUsageCommand,
  PlanTier,
  PlanComparisonView,
  UpgradePreview,
  IapTransactionResult,
  StoreKitExternalRedirectResult,
} from "./schemas.js";
import { RecordUsageCommand as RecordUsageCommandSchema, PLAN_CONFIGS } from "./schemas.js";
import type { SubscriptionRepository } from "./repositories/subscription-repository.js";
import type { UsageRepository } from "./repositories/usage-repository.js";
import type { ReservationRepository } from "./repositories/reservation-repository.js";
import type { WebhookEventRepository } from "./repositories/webhook-event-repository.js";
import type { ExternalPurchaseTokenRepository } from "./repositories/external-purchase-token-repository.js";
import { createSubscriptionService } from "./services/subscription-service.js";
import { createUsageMeteringService } from "./services/usage-metering.js";
import { createReservationService } from "./services/reservation-service.js";
import type { StripeAdapter } from "./adapters/stripe-adapter.js";
import type { AppleIapAdapter } from "./adapters/apple-iap-adapter.js";
import type { GooglePlayAdapter } from "./adapters/google-play-adapter.js";

// =============================================================================
// ヘルパー
// =============================================================================

const recordSchema = z.record(z.string(), z.unknown());

/**
 * unknown を Record<string, unknown> に変換する（型アサーション回避）。
 * JSON シリアライズ可能なオブジェクトを前提とし、parse 失敗時は空オブジェクトを返す。
 */
function toRecord(value: unknown): Record<string, unknown> {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

// =============================================================================
// 依存注入
// =============================================================================

export interface BillingFacadeDeps {
  subscriptionRepo: SubscriptionRepository;
  usageRepo: UsageRepository;
  reservationRepo: ReservationRepository;
  webhookEventRepo: WebhookEventRepository;
  externalPurchaseTokenRepo: ExternalPurchaseTokenRepository;
  stripeAdapter: StripeAdapter;
  appleIapAdapter: AppleIapAdapter;
  googlePlayAdapter: GooglePlayAdapter;
}

// =============================================================================
// BillingFacade インターフェース
// =============================================================================

export interface BillingFacade {
  getSubscription(userId: UserId): Promise<Result<SubscriptionState>>;
  recordUsage(
    cmd: RecordUsageCommand,
  ): Promise<Result<SubscriptionState>>;
  canStartCall(userId: UserId): Promise<Result<true>>;
  reserveMinutes(userId: UserId, sessionId: TranslationSessionId, minutes: number): Promise<Result<true>>;
  reconcile(
    userId: UserId,
    sessionId: TranslationSessionId,
  ): Promise<Result<SubscriptionState>>;
  refundMinutes(sessionId: TranslationSessionId): Promise<Result<true>>;
  createCheckoutSession(
    userId: UserId,
    tier: PlanTier,
    channel: "stripe_web" | "storekit_external",
  ): Promise<Result<{ url: string }>>;
  handleStripeWebhook(
    rawBody: string,
    signature: string,
  ): Promise<Result<true>>;
  handleAppleIapWebhook(
    payload: unknown,
  ): Promise<Result<true>>;
  handleGoogleIapWebhook(
    payload: unknown,
  ): Promise<Result<true>>;

  // =========================================================================
  // [Sprint 2 D5 拡張] UI フロー連携
  // docs/billing-ui-flow.md v1.2 §5 が canonical 詳細
  // =========================================================================

  /** プラン一覧比較ビュー取得 (Settings → Subscription 画面用) */
  getPlanComparison(userId: UserId): Promise<Result<PlanComparisonView>>;

  /** アップグレード日割りプレビュー (Stripe proration preview) */
  previewUpgrade(userId: UserId, targetTier: PlanTier): Promise<Result<UpgradePreview>>;

  /**
   * IAP トランザクション記録 (StoreKit 2)
   * originalTransactionId UNIQUE で冪等
   */
  recordIapTransaction(userId: UserId, transaction: IapTransactionResult): Promise<Result<SubscriptionState>>;

  /**
   * External Purchase 開始: redirectToken (5 分 TTL, 1 回限り) を発行
   * docs/billing-ui-flow.md v1.2 §15.3
   */
  startExternalPurchase(userId: UserId, targetTier: PlanTier): Promise<Result<{ redirectUrl: string }>>;

  /**
   * External Purchase 完了: redirectToken を検証してサブスク更新
   * TTL 切れ / 使用済みは BILLING_PAYMENT_FAILED
   */
  completeExternalPurchase(userId: UserId, redirect: StoreKitExternalRedirectResult): Promise<Result<SubscriptionState>>;

  /** サブスクリプションキャンセル (atPeriodEnd=false は IAP では拒否) */
  cancelSubscription(userId: UserId, atPeriodEnd: boolean): Promise<Result<SubscriptionState>>;

  /**
   * Restore Purchases: restoredCount=0 + subscription=null は正常な空結果
   * BILLING_RESTORE_NO_PURCHASE は UI 文言テーブルのみ参照
   */
  restorePurchases(
    userId: UserId,
    transactions: IapTransactionResult[],
  ): Promise<Result<{ restoredCount: number; subscription: SubscriptionState | null }>>;
}

// =============================================================================
// Factory
// =============================================================================

export function createBillingFacade(deps: BillingFacadeDeps): BillingFacade {
  const {
    subscriptionRepo,
    usageRepo,
    reservationRepo,
    webhookEventRepo,
    externalPurchaseTokenRepo,
    stripeAdapter,
    appleIapAdapter,
    googlePlayAdapter,
  } = deps;

  const subscriptionService = createSubscriptionService({ subscriptionRepo });
  const usageMeteringService = createUsageMeteringService({
    subscriptionRepo,
    usageRepo,
  });
  const reservationService = createReservationService({
    subscriptionRepo,
    usageRepo,
    reservationRepo,
  });

  return {
    // =========================================================================
    // サブスクリプション状態取得
    // =========================================================================
    async getSubscription(
      userId: UserId,
    ): Promise<Result<SubscriptionState>> {
      return subscriptionService.getSubscription(userId);
    },

    // =========================================================================
    // heartbeat 利用量記録
    // =========================================================================
    async recordUsage(
      cmd: RecordUsageCommand,
    ): Promise<Result<SubscriptionState>> {
      // 境界バリデーション
      const validated = validate(RecordUsageCommandSchema, cmd);
      if (!validated.ok) return validated;

      const result = await usageMeteringService.recordUsage(validated.data);
      if (!result.ok) return result;
      return ok(result.data.subscriptionState);
    },

    // =========================================================================
    // 通話開始前チェック
    // =========================================================================
    async canStartCall(userId: UserId): Promise<Result<true>> {
      return subscriptionService.canStartCall(userId);
    },

    // =========================================================================
    // 分数予約
    // =========================================================================
    async reserveMinutes(
      userId: UserId,
      sessionId: TranslationSessionId,
      minutes: number,
    ): Promise<Result<true>> {
      return reservationService.reserveMinutesWithSession(userId, sessionId, minutes);
    },

    // =========================================================================
    // 精算
    // =========================================================================
    async reconcile(
      userId: UserId,
      sessionId: TranslationSessionId,
    ): Promise<Result<SubscriptionState>> {
      return reservationService.reconcile(userId, sessionId);
    },

    // =========================================================================
    // 異常終了時の予約解放
    // =========================================================================
    async refundMinutes(
      sessionId: TranslationSessionId,
    ): Promise<Result<true>> {
      return reservationService.refundMinutes(sessionId);
    },

    // =========================================================================
    // Stripe Checkout Session 作成
    // =========================================================================
    async createCheckoutSession(
      userId: UserId,
      tier: PlanTier,
      channel: "stripe_web" | "storekit_external",
    ): Promise<Result<{ url: string }>> {
      const result = await stripeAdapter.createCheckoutSession({
        userId,
        tier,
        channel,
      });
      if (!result.ok) return result;
      return ok({ url: result.data.url });
    },

    // =========================================================================
    // Stripe Webhook 処理
    // =========================================================================
    async handleStripeWebhook(
      rawBody: string,
      signature: string,
    ): Promise<Result<true>> {
      // 1. 署名検証
      const eventResult = await stripeAdapter.verifyWebhook(rawBody, signature);
      if (!eventResult.ok) return eventResult;

      const event = eventResult.data;

      // 2. webhook_events に冪等 INSERT
      const insertResult = await webhookEventRepo.insertIdempotent({
        provider: "stripe",
        externalEventId: event.id,
        eventType: event.type,
        payload: toRecord(event),
      });
      if (!insertResult.ok) return insertResult;

      // 既に処理済みなら OK を返す（冪等）
      if (!insertResult.data.isNew) {
        return ok(true);
      }

      const webhookId = insertResult.data.event.id;

      // 3. イベントタイプ別処理
      try {
        if (event.type === "checkout.session.completed") {
          const parsed = stripeAdapter.parseCheckoutCompleted(event);
          if (!parsed.ok) {
            await webhookEventRepo.markFailed(webhookId, parsed.error.message);
            return parsed;
          }

          const d = parsed.data;
          const userIdResult = brandUserId(d.userId);
          if (!userIdResult.success) {
            const msg = "Stripe webhook の userId が UUID 形式でありません";
            await webhookEventRepo.markFailed(webhookId, msg);
            return err({
              code: "BILLING_INVALID_RECEIPT",
              message: msg,
              retryable: false,
            });
          }
          await subscriptionRepo.updatePlan(
            userIdResult.data,
            {
              planTier: d.tier,
              purchaseChannel: d.channel,
              stripeCustomerId: d.stripeCustomerId,
              stripeSubscriptionId: d.stripeSubscriptionId,
              currentPeriodStart: d.currentPeriodStart,
              currentPeriodEnd: d.currentPeriodEnd,
              cancelAtPeriodEnd: false,
            },
          );
        } else if (event.type === "customer.subscription.deleted") {
          const parsed = stripeAdapter.parseSubscriptionDeleted(event);
          if (!parsed.ok) {
            await webhookEventRepo.markFailed(webhookId, parsed.error.message);
            return parsed;
          }
          // サブスク削除: Free プランに戻す（簡易実装）
          // 実際の実装では stripe_subscription_id からユーザーを検索
          // ここでは markProcessed のみ
        }

        await webhookEventRepo.markProcessed(webhookId);
        return ok(true);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await webhookEventRepo.markFailed(webhookId, msg);
        return err({
          code: "INTERNAL_ERROR",
          message: `Stripe webhook 処理中にエラーが発生しました: ${msg}`,
          retryable: true,
        });
      }
    },

    // =========================================================================
    // Apple IAP Webhook 処理
    // =========================================================================
    async handleAppleIapWebhook(
      payload: unknown,
    ): Promise<Result<true>> {
      // 1. ペイロード解析
      const parsed = appleIapAdapter.parseWebhookPayload(payload);
      if (!parsed.ok) return parsed;

      const notification = parsed.data;

      // 2. 処理対象かチェック
      if (!appleIapAdapter.shouldProcessNotification(notification.notificationType)) {
        return ok(true);
      }

      // 3. webhook_events に冪等 INSERT
      const insertResult = await webhookEventRepo.insertIdempotent({
        provider: "apple_iap",
        externalEventId: notification.idempotencyKey,
        eventType: notification.notificationType,
        payload: toRecord(notification),
      });
      if (!insertResult.ok) return insertResult;

      if (!insertResult.data.isNew) {
        return ok(true);
      }

      const webhookId = insertResult.data.event.id;

      try {
        // 4. サブスクリプション更新は apps/server 側が iap_original_transaction_id で検索して行う
        // ここでは markProcessed のみ
        await webhookEventRepo.markProcessed(webhookId);
        return ok(true);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await webhookEventRepo.markFailed(webhookId, msg);
        return err({
          code: "INTERNAL_ERROR",
          message: `Apple IAP webhook 処理中にエラーが発生しました: ${msg}`,
          retryable: true,
        });
      }
    },

    // =========================================================================
    // Google Play IAP Webhook 処理
    // =========================================================================
    async handleGoogleIapWebhook(
      payload: unknown,
    ): Promise<Result<true>> {
      // 1. ペイロード解析
      const parsed = googlePlayAdapter.parseWebhookPayload(payload);
      if (!parsed.ok) {
        // テスト通知は VALIDATION_ERROR で返るが、200 を返してよい
        if (parsed.error.code === "VALIDATION_ERROR") {
          return ok(true);
        }
        return parsed;
      }

      const notification = parsed.data;

      // 2. 処理対象かチェック
      if (!googlePlayAdapter.shouldProcessNotification(notification.notificationType)) {
        return ok(true);
      }

      // 3. webhook_events に冪等 INSERT
      const insertResult = await webhookEventRepo.insertIdempotent({
        provider: "google_play",
        externalEventId: notification.idempotencyKey,
        eventType: String(notification.notificationType),
        payload: toRecord(notification),
      });
      if (!insertResult.ok) return insertResult;

      if (!insertResult.data.isNew) {
        return ok(true);
      }

      const webhookId = insertResult.data.event.id;

      try {
        await webhookEventRepo.markProcessed(webhookId);
        return ok(true);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await webhookEventRepo.markFailed(webhookId, msg);
        return err({
          code: "INTERNAL_ERROR",
          message: `Google Play webhook 処理中にエラーが発生しました: ${msg}`,
          retryable: true,
        });
      }
    },

    // =========================================================================
    // [Sprint 2 D5] getPlanComparison
    // =========================================================================
    async getPlanComparison(userId: UserId): Promise<Result<PlanComparisonView>> {
      const subResult = await subscriptionService.getSubscription(userId);
      if (!subResult.ok) return subResult;
      const currentTier = subResult.data.plan.tier;

      const plans: PlanComparisonView["plans"] = (["free", "light", "standard", "business"] as const).map((tier) => {
        const cfg = PLAN_CONFIGS[tier];
        return {
          tier,
          name: tier.charAt(0).toUpperCase() + tier.slice(1),
          monthlyPriceYen: cfg.monthlyPriceYen,
          includedMinutes: cfg.includedMinutes,
          overageRateYen: cfg.overageRateYen,
          transcriptRetentionDays: cfg.transcriptRetentionDays,
          features: [],
          isRecommended: tier === "standard",
          isCurrent: tier === currentTier,
        };
      });

      return ok({ currentTier, plans });
    },

    // =========================================================================
    // [Sprint 2 D5] previewUpgrade
    // =========================================================================
    async previewUpgrade(userId: UserId, targetTier: PlanTier): Promise<Result<UpgradePreview>> {
      const subResult = await subscriptionService.getSubscription(userId);
      if (!subResult.ok) return subResult;

      if (subResult.data.plan.tier === targetTier) {
        return err({
          code: "BILLING_INVALID_PLAN_CHANGE",
          message: "現在のプランと同じプランには変更できません",
          retryable: false,
        });
      }

      // Stripe proration preview — アダプタ経由 (未実装時は簡易計算)
      const previewResult = await stripeAdapter.previewUpgrade(userId, targetTier);
      if (!previewResult.ok) return previewResult;

      return ok(previewResult.data);
    },

    // =========================================================================
    // [Sprint 2 D5] recordIapTransaction
    // =========================================================================
    async recordIapTransaction(
      userId: UserId,
      transaction: IapTransactionResult,
    ): Promise<Result<SubscriptionState>> {
      // AppleIapAdapter で productId → tier マッピング
      const tierResult = appleIapAdapter.mapProductIdToTier(transaction.productId);
      if (!tierResult.ok) {
        return err({
          code: "BILLING_IAP_RECEIPT_INVALID",
          message: `不明な productId: ${transaction.productId}`,
          retryable: false,
        });
      }
      const tier = tierResult.data;
      const now = new Date().toISOString();
      const periodStart = transaction.purchaseDate;
      const periodEnd = transaction.expirationDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const updateResult = await subscriptionRepo.updatePlan(userId, {
        planTier: tier,
        purchaseChannel: "iap_apple",
        iapOriginalTransactionId: transaction.originalTransactionId,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      });
      if (!updateResult.ok) return updateResult;

      return subscriptionService.getSubscription(userId);
    },

    // =========================================================================
    // [Sprint 2 D5] startExternalPurchase
    // =========================================================================
    async startExternalPurchase(
      userId: UserId,
      targetTier: PlanTier,
    ): Promise<Result<{ redirectUrl: string }>> {
      // 1. Stripe Checkout Session を作成
      const checkoutResult = await stripeAdapter.createCheckoutSession({
        userId,
        tier: targetTier,
        channel: "storekit_external",
      });
      if (!checkoutResult.ok) return checkoutResult;

      // 2. redirectToken 発行・DB 保存
      const tokenRow = await externalPurchaseTokenRepo.create({
        userId,
        targetTier,
        stripeSessionId: checkoutResult.data.sessionId,
      });
      if (!tokenRow.ok) return tokenRow;

      return ok({ redirectUrl: `${checkoutResult.data.url}&token=${tokenRow.data.token}` });
    },

    // =========================================================================
    // [Sprint 2 D5] completeExternalPurchase
    // =========================================================================
    async completeExternalPurchase(
      userId: UserId,
      redirect: StoreKitExternalRedirectResult,
    ): Promise<Result<SubscriptionState>> {
      // 1. redirectToken の検証
      const tokenResult = await externalPurchaseTokenRepo.findValidByToken(redirect.redirectToken);
      if (!tokenResult.ok) return tokenResult;
      if (!tokenResult.data) {
        return err({
          code: "BILLING_PAYMENT_FAILED",
          message: "redirectToken が無効または期限切れです",
          retryable: false,
        });
      }
      const tokenRow = tokenResult.data;

      // 2. トークンを使用済みにマーク
      const markResult = await externalPurchaseTokenRepo.markUsed(tokenRow.id);
      if (!markResult.ok) return markResult;

      // 3. サブスクリプション更新
      const now = new Date().toISOString();
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const updateResult = await subscriptionRepo.updatePlan(userId, {
        planTier: tokenRow.target_tier,
        purchaseChannel: "storekit_external",
        stripeSubscriptionId: redirect.stripeSubscriptionId,
        stripeCustomerId: null,
        iapOriginalTransactionId: null,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      });
      if (!updateResult.ok) return updateResult;

      return subscriptionService.getSubscription(userId);
    },

    // =========================================================================
    // [Sprint 2 D5] cancelSubscription
    // =========================================================================
    async cancelSubscription(
      userId: UserId,
      atPeriodEnd: boolean,
    ): Promise<Result<SubscriptionState>> {
      const subResult = await subscriptionService.getSubscription(userId);
      if (!subResult.ok) return subResult;

      const sub = subResult.data;

      // IAP チャネルは即時キャンセル不可
      if (!atPeriodEnd && (sub.iapPlatform !== null)) {
        return err({
          code: "BILLING_INVALID_PLAN_CHANGE",
          message: "IAP チャネルでの即時キャンセルはサポートされていません",
          retryable: false,
        });
      }

      // Stripe サブスクリプションがある場合のみ Stripe 経由でキャンセル
      if (sub.stripeSubscriptionId) {
        const cancelResult = await stripeAdapter.cancelSubscription(
          sub.stripeSubscriptionId,
          atPeriodEnd,
        );
        if (!cancelResult.ok) return cancelResult;
      }

      const updateResult = await subscriptionRepo.updatePlan(userId, {
        planTier: sub.plan.tier,
        purchaseChannel: sub.plan.tier === "free" ? "free" : "stripe_web",
        stripeCustomerId: sub.stripeCustomerId,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        iapOriginalTransactionId: sub.iapOriginalTransactionId,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: atPeriodEnd,
      });
      if (!updateResult.ok) return updateResult;

      return subscriptionService.getSubscription(userId);
    },

    // =========================================================================
    // [Sprint 2 D5] restorePurchases
    // =========================================================================
    async restorePurchases(
      userId: UserId,
      transactions: IapTransactionResult[],
    ): Promise<Result<{ restoredCount: number; subscription: SubscriptionState | null }>> {
      let restoredCount = 0;
      let latestSubscription: SubscriptionState | null = null;

      for (const tx of transactions) {
        const tierResult = appleIapAdapter.mapProductIdToTier(tx.productId);
        if (!tierResult.ok) continue;

        const tier = tierResult.data;
        const periodEnd = tx.expirationDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const updateResult = await subscriptionRepo.updatePlan(userId, {
          planTier: tier,
          purchaseChannel: "iap_apple",
          iapOriginalTransactionId: tx.originalTransactionId,
          currentPeriodStart: tx.purchaseDate,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
        });
        if (updateResult.ok) {
          restoredCount++;
          const subResult = await subscriptionService.getSubscription(userId);
          if (subResult.ok) latestSubscription = subResult.data;
        }
      }

      return ok({ restoredCount, subscription: latestSubscription });
    },
  };
}
