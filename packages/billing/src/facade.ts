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
} from "./schemas.js";
import { RecordUsageCommand as RecordUsageCommandSchema } from "./schemas.js";
import type { SubscriptionRepository } from "./repositories/subscription-repository.js";
import type { UsageRepository } from "./repositories/usage-repository.js";
import type { ReservationRepository } from "./repositories/reservation-repository.js";
import type { WebhookEventRepository } from "./repositories/webhook-event-repository.js";
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
  };
}
