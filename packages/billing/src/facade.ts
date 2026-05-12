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

import type {
  SubscriptionState,
  RecordUsageCommand,
  PlanTier,
  PurchaseChannel,
} from "./schemas.js";
import { PLAN_CONFIGS, RecordUsageCommand as RecordUsageCommandSchema } from "./schemas.js";
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
import type { StripeWebCheckoutAdapter } from "./adapters/stripe-web-checkout-adapter.js";
import type { IapAdapter } from "./adapters/iap-adapter.js";
import type { ExternalPurchaseAdapter } from "./adapters/external-purchase-adapter.js";
import type { EventBus } from "./events.js";
import { publishSubscriptionUpgraded, publishSubscriptionCanceled } from "./events.js";
import type {
  PlanComparisonView,
  UpgradePreview,
  IapTransactionResult,
  StoreKitExternalRedirectResult,
} from "./view-models/index.js";

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
  stripeWebCheckoutAdapter: StripeWebCheckoutAdapter;
  iapAdapter: IapAdapter;
  externalPurchaseAdapter: ExternalPurchaseAdapter;
  /** EventBus は省略可 (省略時はコンソールログにフォールバック) */
  eventBus?: EventBus;
}

// =============================================================================
// BillingFacade インターフェース
// =============================================================================

export interface BillingFacade {
  // =========================================================================
  // 既存メソッド (docs/module-contracts.md §2.3 canonical)
  // =========================================================================
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
  // 新規メソッド (D5 billing-ui-flow.md v1.2 §5 canonical)
  // Result<T> = Result<T, AppError> の省略形 (module-contracts.md §2.3 注釈)
  // =========================================================================

  /**
   * プラン比較ビューを取得する。
   * @idempotent 副作用なし
   * @retryable true
   */
  getPlanComparison(userId: UserId): Promise<Result<PlanComparisonView>>;

  /**
   * アップグレードの日割り計算プレビューを取得する。
   * Stripe Proration Preview API を呼び出す。Free → upgrade は proratedAmountYen=0。
   * 同一プラン指定で BILLING_INVALID_PLAN_CHANGE (400)。
   * @idempotent 副作用なし
   * @retryable true
   */
  previewUpgrade(userId: UserId, targetTier: PlanTier): Promise<Result<UpgradePreview>>;

  /**
   * StoreKit 2 の Transaction を server で検証し、サブスクリプションを更新する。
   * originalTransactionId の UNIQUE 制約で重複処理を防止 (冪等)。
   * @idempotent originalTransactionId で重複排除
   * @retryable false (署名失敗は再試行不可)
   */
  recordIapTransaction(
    userId: UserId,
    transaction: IapTransactionResult,
  ): Promise<Result<SubscriptionState>>;

  /**
   * StoreKit External Purchase 開始。
   * redirectToken を生成・DB に保存し、Stripe Checkout Session を作成する。
   * @idempotent false (呼び出しごとに新規 Stripe Session を作成)
   * @retryable true
   */
  startExternalPurchase(
    userId: UserId,
    targetTier: PlanTier,
  ): Promise<Result<{ redirectUrl: string }>>;

  /**
   * StoreKit External Purchase 完了。
   * redirectToken の TTL + 使用済みフラグを検証し、サブスクを更新する。
   * @idempotent redirectToken で重複排除 (二重消費防止)
   * @retryable false (TTL 切れは再試行不可)
   */
  completeExternalPurchase(
    userId: UserId,
    redirect: StoreKitExternalRedirectResult,
  ): Promise<Result<SubscriptionState>>;

  /**
   * サブスクリプションをキャンセルする。
   * atPeriodEnd=true: 期末キャンセル (cancelAtPeriodEnd=true)
   * atPeriodEnd=false: 即時キャンセル (Free プランに戻す)
   * IAP チャネルでの即時キャンセル不可 (BILLING_INVALID_PLAN_CHANGE)。
   * @idempotent true (既にキャンセル済みなら OK)
   * @retryable true
   */
  cancelSubscription(
    userId: UserId,
    atPeriodEnd: boolean,
  ): Promise<Result<SubscriptionState>>;

  /**
   * 購入を復元する (iOS App Store ガイドライン必須)。
   * restoredCount=0 + subscription=null は正常な空結果 (エラーにしない)。
   * @idempotent true (同一 originalTransactionId は重複スキップ)
   * @retryable true
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
    externalPurchaseTokenRepo: _externalPurchaseTokenRepo, // 直接アクセスは externalPurchaseAdapter 経由
    stripeAdapter,
    appleIapAdapter,
    googlePlayAdapter,
    stripeWebCheckoutAdapter,
    iapAdapter,
    externalPurchaseAdapter,
    eventBus,
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
    // [D5 拡張] getPlanComparison
    // =========================================================================
    async getPlanComparison(
      userId: UserId,
    ): Promise<Result<PlanComparisonView>> {
      // 現在のサブスクリプションを取得して currentTier を解決
      const subResult = await subscriptionRepo.findByUserId(userId);
      if (!subResult.ok) return subResult;

      const currentTier = subResult.data.plan_tier;
      const tierOrder: PlanTier[] = ["free", "light", "standard", "business"];

      const plans = tierOrder.map((tier) => {
        const cfg = PLAN_CONFIGS[tier];
        return {
          tier,
          name: tier.charAt(0).toUpperCase() + tier.slice(1), // i18n key 解決済み表示名
          monthlyPriceYen: cfg.monthlyPriceYen,
          includedMinutes: cfg.includedMinutes,
          overageRateYen: cfg.overageRateYen,
          transcriptRetentionDays: cfg.transcriptRetentionDays,
          features: buildPlanFeatures(tier),
          isRecommended: tier === "standard",
          isCurrent: tier === currentTier,
        };
      });

      return ok({ currentTier, plans });
    },

    // =========================================================================
    // [D5 拡張] previewUpgrade
    // =========================================================================
    async previewUpgrade(
      userId: UserId,
      targetTier: PlanTier,
    ): Promise<Result<UpgradePreview>> {
      // 現在のサブスクリプションを取得
      const subResult = await subscriptionRepo.findByUserId(userId);
      if (!subResult.ok) return subResult;

      const currentTier = subResult.data.plan_tier;

      // 同一プランチェック (BILLING_INVALID_PLAN_CHANGE)
      if (currentTier === targetTier) {
        return err({
          code: "BILLING_INVALID_PLAN_CHANGE",
          message: "現在と同じプランへの変更はできません",
          retryable: false,
        });
      }

      try {
        // Stripe Proration Preview (stripeWebCheckoutAdapter 委譲)
        const previewResult = await stripeWebCheckoutAdapter.getUpgradePreview(
          subResult.data.stripe_subscription_id,
          currentTier,
          targetTier,
        );
        return previewResult;
      } catch (e: unknown) {
        return err({
          code: "BILLING_UPGRADE_PREVIEW_FAILED",
          message: e instanceof Error ? e.message : "プレビュー取得に失敗しました",
          retryable: true,
        });
      }
    },

    // =========================================================================
    // [D5 拡張] recordIapTransaction
    // =========================================================================
    async recordIapTransaction(
      userId: UserId,
      transaction: IapTransactionResult,
    ): Promise<Result<SubscriptionState>> {
      // 1. JWS 検証 (Phase 1a: デコード + productId 解決 + 有効期限チェック)
      const verifyResult = await iapAdapter.verifyIapTransaction(transaction);
      if (!verifyResult.ok) return verifyResult;

      const verified = verifyResult.data;

      // 2. subscriptions を updatePlan (UNIQUE 制約で重複排除)
      const now = new Date();
      const periodEnd = transaction.expirationDate
        ? new Date(transaction.expirationDate)
        : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      try {
        await subscriptionRepo.updatePlan(userId, {
          planTier: verified.tier,
          purchaseChannel: "iap_apple",
          iapOriginalTransactionId: verified.originalTransactionId,
          currentPeriodStart: now.toISOString(),
          currentPeriodEnd: periodEnd.toISOString(),
          cancelAtPeriodEnd: false,
        });
      } catch (e: unknown) {
        // UNIQUE 制約違反 (originalTransactionId 重複) → 冪等: OK として処理
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("unique") || msg.includes("duplicate")) {
          // 既存状態を取得して返す
          return subscriptionService.getSubscription(userId);
        }
        return err({
          code: "INTERNAL_ERROR",
          message: `IAP トランザクション記録中にエラーが発生しました: ${msg}`,
          retryable: true,
        });
      }

      // 3. 更新後の状態を取得
      const stateResult = await subscriptionService.getSubscription(userId);
      if (!stateResult.ok) return stateResult;

      // 4. DomainEvent 発行 (billing.subscription_upgraded)
      const currentSubResult = await subscriptionRepo.findByUserId(userId);
      const fromTier = currentSubResult.ok ? currentSubResult.data.plan_tier : "free";
      await publishSubscriptionUpgraded(eventBus, {
        userId,
        fromTier,
        toTier: verified.tier,
        channel: "iap_apple",
      });

      return stateResult;
    },

    // =========================================================================
    // [D5 拡張] startExternalPurchase
    // =========================================================================
    async startExternalPurchase(
      userId: UserId,
      targetTier: PlanTier,
    ): Promise<Result<{ redirectUrl: string }>> {
      // 1. Stripe Checkout Session 作成 (stripe_web ではなく storekit_external チャネル)
      const checkoutResult = await stripeWebCheckoutAdapter.createCheckoutSession(
        userId as string,
        targetTier,
        "storekit_external",
      );
      if (!checkoutResult.ok) return checkoutResult;

      const { checkoutUrl, sessionId } = checkoutResult.data;

      // 2. ExternalPurchaseAdapter で redirectToken 生成 + DB 保存 + Apple API 報告
      const startResult = await externalPurchaseAdapter.startExternalPurchase(
        userId,
        targetTier,
        checkoutUrl,
        sessionId,
      );
      if (!startResult.ok) return startResult;

      return ok({ redirectUrl: startResult.data.redirectUrl });
    },

    // =========================================================================
    // [D5 拡張] completeExternalPurchase
    // =========================================================================
    async completeExternalPurchase(
      userId: UserId,
      redirect: StoreKitExternalRedirectResult,
    ): Promise<Result<SubscriptionState>> {
      // 1. redirectToken の TTL + 二重消費防止検証
      const validateResult =
        await externalPurchaseAdapter.validateAndConsumeRedirectToken(redirect);
      if (!validateResult.ok) return validateResult;

      const { targetTier } = validateResult.data;

      // 2. サブスクリプションを更新 (storekit_external チャネル)
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      await subscriptionRepo.updatePlan(userId, {
        planTier: targetTier,
        purchaseChannel: "storekit_external",
        stripeSubscriptionId: redirect.stripeSubscriptionId,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
        cancelAtPeriodEnd: false,
      });

      // 3. 更新後の状態を取得
      const stateResult = await subscriptionService.getSubscription(userId);
      if (!stateResult.ok) return stateResult;

      // 4. DomainEvent 発行
      const currentSubResult = await subscriptionRepo.findByUserId(userId);
      const fromTier = currentSubResult.ok ? currentSubResult.data.plan_tier : "free";
      await publishSubscriptionUpgraded(eventBus, {
        userId,
        fromTier,
        toTier: targetTier,
        channel: "storekit_external",
      });

      return stateResult;
    },

    // =========================================================================
    // [D5 拡張] cancelSubscription
    // =========================================================================
    async cancelSubscription(
      userId: UserId,
      atPeriodEnd: boolean,
    ): Promise<Result<SubscriptionState>> {
      // 1. 現在のサブスクを取得
      const subResult = await subscriptionRepo.findByUserId(userId);
      if (!subResult.ok) return subResult;

      const row = subResult.data;
      const channel = row.purchase_channel as PurchaseChannel;
      const fromTier = row.plan_tier;

      // 2. IAP チャネルでの即時キャンセルは不可
      if (!atPeriodEnd && (channel === "iap_apple" || channel === "iap_google")) {
        return err({
          code: "BILLING_INVALID_PLAN_CHANGE",
          message:
            "App Store / Google Play でのサブスクリプションは iOS 設定アプリ経由でのみキャンセル可能です。" +
            "期末キャンセル (atPeriodEnd=true) のみ許容されます。",
          retryable: false,
        });
      }

      // 3. 既にキャンセル済みなら冪等 OK
      if (row.cancel_at_period_end && atPeriodEnd) {
        return subscriptionService.getSubscription(userId);
      }

      if (atPeriodEnd) {
        // 期末キャンセル: cancelAtPeriodEnd=true をセット
        await subscriptionRepo.updatePlan(userId, {
          planTier: row.plan_tier,
          purchaseChannel: channel,
          cancelAtPeriodEnd: true,
        });
      } else {
        // 即時キャンセル: Free プランに戻す (Stripe / 非 IAP のみ)
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        await subscriptionRepo.updatePlan(userId, {
          planTier: "free",
          purchaseChannel: "free",
          stripeSubscriptionId: null,
          stripeCustomerId: null,
          cancelAtPeriodEnd: false,
          currentPeriodStart: now.toISOString(),
          currentPeriodEnd: periodEnd.toISOString(),
        });
      }

      // 4. 更新後の状態を取得
      const stateResult = await subscriptionService.getSubscription(userId);
      if (!stateResult.ok) return stateResult;

      // 5. DomainEvent 発行 (billing.subscription_canceled)
      await publishSubscriptionCanceled(eventBus, {
        userId,
        fromTier,
        channel,
        cancelAtPeriodEnd: atPeriodEnd,
      });

      return stateResult;
    },

    // =========================================================================
    // [D5 拡張] restorePurchases
    // =========================================================================
    async restorePurchases(
      userId: UserId,
      transactions: IapTransactionResult[],
    ): Promise<Result<{ restoredCount: number; subscription: SubscriptionState | null }>> {
      // transactions=[] は正常な空結果 (BILLING_RESTORE_NO_PURCHASE はエラーにしない)
      if (transactions.length === 0) {
        return ok({ restoredCount: 0, subscription: null });
      }

      const verifiedTransactions: Parameters<typeof iapAdapter.selectLatestTransaction>[0] = [];

      for (const transaction of transactions) {
        const verifyResult = await iapAdapter.verifyIapTransaction(transaction);
        if (verifyResult.ok) {
          verifiedTransactions.push(verifyResult.data);
        }
        // 検証失敗は個別スキップ (全失敗でも restoredCount=0 で正常返却)
      }

      if (verifiedTransactions.length === 0) {
        return ok({ restoredCount: 0, subscription: null });
      }

      // 最新の有効なトランザクションを選択して DB 更新
      const latestTransaction = iapAdapter.selectLatestTransaction(verifiedTransactions);
      if (latestTransaction === null) {
        return ok({ restoredCount: 0, subscription: null });
      }

      const now = new Date();
      const periodEnd = latestTransaction.expirationDate
        ? new Date(latestTransaction.expirationDate)
        : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      try {
        await subscriptionRepo.updatePlan(userId, {
          planTier: latestTransaction.tier,
          purchaseChannel: "iap_apple",
          iapOriginalTransactionId: latestTransaction.originalTransactionId,
          currentPeriodStart: now.toISOString(),
          currentPeriodEnd: periodEnd.toISOString(),
          cancelAtPeriodEnd: false,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // UNIQUE 制約違反 (同一 originalTransactionId) → 冪等
        if (!msg.includes("unique") && !msg.includes("duplicate")) {
          return err({
            code: "INTERNAL_ERROR",
            message: `Restore Purchases 処理中にエラーが発生しました: ${msg}`,
            retryable: true,
          });
        }
      }

      const stateResult = await subscriptionService.getSubscription(userId);
      if (!stateResult.ok) return stateResult;

      return ok({
        restoredCount: verifiedTransactions.length,
        subscription: stateResult.data,
      });
    },
  };
}

// =============================================================================
// ヘルパー
// =============================================================================

/**
 * プランティアに対応する機能リストを返す (i18n key 解決済みの表示文字列)。
 * 実際のアプリでは i18n ライブラリから解決するが、facade 層では英語文字列を返す。
 */
function buildPlanFeatures(tier: PlanTier): string[] {
  switch (tier) {
    case "free":
      return ["5 min/month", "7-day transcript retention"];
    case "light":
      return [
        "30 min/month",
        "Overage: ¥40/min",
        "30-day transcript retention",
      ];
    case "standard":
      return [
        "120 min/month",
        "Overage: ¥30/min",
        "90-day transcript retention",
        "Recommended",
      ];
    case "business":
      return [
        "500 min/month",
        "Overage: ¥25/min",
        "365-day transcript retention",
        "Priority support",
      ];
  }
}
