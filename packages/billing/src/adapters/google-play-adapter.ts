/**
 * GooglePlayAdapter — Google Play Real-Time Developer Notifications (RTDN) 処理
 *
 * adapters/* 内では型アサーション例外許可（CLAUDE.md より）。
 *
 * - Google Play RTDN の SubscriptionNotification を解析
 * - 冪等性キー: purchaseToken
 * - Pub/Sub 経由で届くメッセージを処理
 */

import { z } from "zod";
import type { Result} from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

import type { PlanTier } from "../schemas.ts";

// Google Play RTDN Pub/Sub メッセージスキーマ
// https://developer.android.com/google/play/billing/rtdn-reference
const GoogleRtdnMessageSchema = z.object({
  message: z.object({
    data: z.string(), // Base64 エンコードされた JSON
    messageId: z.string(),
    publishTime: z.string(),
  }),
  subscription: z.string(),
});

// デベロッパー通知スキーマ
const DeveloperNotificationSchema = z.object({
  version: z.string(),
  packageName: z.string(),
  eventTimeMillis: z.string(),
  subscriptionNotification: z
    .object({
      version: z.string(),
      notificationType: z.number().int(),
      purchaseToken: z.string(),
      subscriptionId: z.string(),
    })
    .optional(),
  testNotification: z
    .object({
      version: z.string(),
    })
    .optional(),
});

// SubscriptionNotification のタイプ
// https://developer.android.com/google/play/billing/rtdn-reference#subscription
const SUBSCRIPTION_NOTIFICATION_TYPE = {
  SUBSCRIPTION_RECOVERED: 1,
  SUBSCRIPTION_RENEWED: 2,
  SUBSCRIPTION_CANCELED: 3,
  SUBSCRIPTION_PURCHASED: 4,
  SUBSCRIPTION_ON_HOLD: 5,
  SUBSCRIPTION_IN_GRACE_PERIOD: 6,
  SUBSCRIPTION_RESTARTED: 7,
  SUBSCRIPTION_PRICE_CHANGE_CONFIRMED: 8,
  SUBSCRIPTION_DEFERRED: 9,
  SUBSCRIPTION_PAUSED: 10,
  SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED: 11,
  SUBSCRIPTION_REVOKED: 12,
  SUBSCRIPTION_EXPIRED: 13,
} as const;

// Google Play 製品 ID → PlanTier マッピング
export const GOOGLE_PRODUCT_ID_MAP: Record<string, PlanTier> = {
  trancall_light_monthly: "light",
  trancall_standard_monthly: "standard",
  trancall_business_monthly: "business",
};

export interface GooglePlayWebhookResult {
  /** 冪等性キー（purchaseToken） */
  idempotencyKey: string;
  notificationType: number;
  purchaseToken: string;
  subscriptionId: string;
  tier: PlanTier;
  packageName: string;
}

export function createGooglePlayAdapter() {
  return {
    /**
     * Google Play RTDN Pub/Sub メッセージを解析する。
     *
     * @param payload 未検証の受信ペイロード
     */
    parseWebhookPayload(
      payload: unknown,
    ): Result<GooglePlayWebhookResult> {
      // Pub/Sub メッセージ形式の場合
      const pubSubParsed = GoogleRtdnMessageSchema.safeParse(payload);
      if (pubSubParsed.success) {
        const data = pubSubParsed.data.message.data;
        const decoded = decodeBase64Json(data);
        if (!decoded.ok) return decoded;
        return this.parseNotification(decoded.data);
      }

      // 直接通知形式の場合（テスト用）
      return this.parseNotification(payload);
    },

    /**
     * デベロッパー通知を解析する。
     */
    parseNotification(
      rawNotification: unknown,
    ): Result<GooglePlayWebhookResult> {
      const parsed = DeveloperNotificationSchema.safeParse(rawNotification);
      if (!parsed.success) {
        return err({
          code: "BILLING_INVALID_RECEIPT",
          message: "Google Play 通知ペイロードの形式が不正です",
          retryable: false,
          httpStatus: 400,
          provider: "google_play",
          details: { issues: parsed.error.issues.map((i) => i.message) },
        });
      }

      const notification = parsed.data;

      // テスト通知は無視
      if (notification.testNotification) {
        return err({
          code: "VALIDATION_ERROR",
          message: "テスト通知はスキップします",
          retryable: false,
        });
      }

      const sub = notification.subscriptionNotification;
      if (!sub) {
        return err({
          code: "BILLING_INVALID_RECEIPT",
          message: "subscriptionNotification が存在しません",
          retryable: false,
          provider: "google_play",
        });
      }

      const tier = GOOGLE_PRODUCT_ID_MAP[sub.subscriptionId];
      if (tier === undefined) {
        return err({
          code: "BILLING_INVALID_RECEIPT",
          message: `未知の Google Play 製品 ID: ${sub.subscriptionId}`,
          retryable: false,
          provider: "google_play",
        });
      }

      return ok({
        idempotencyKey: sub.purchaseToken,
        notificationType: sub.notificationType,
        purchaseToken: sub.purchaseToken,
        subscriptionId: sub.subscriptionId,
        tier,
        packageName: notification.packageName,
      });
    },

    /**
     * 通知タイプからサブスクリプションのアクティブ状態を判定する。
     */
    isActive(notificationType: number): boolean {
      const activeTypes: ReadonlySet<number> = new Set<number>([
        SUBSCRIPTION_NOTIFICATION_TYPE.SUBSCRIPTION_RECOVERED,
        SUBSCRIPTION_NOTIFICATION_TYPE.SUBSCRIPTION_RENEWED,
        SUBSCRIPTION_NOTIFICATION_TYPE.SUBSCRIPTION_PURCHASED,
        SUBSCRIPTION_NOTIFICATION_TYPE.SUBSCRIPTION_RESTARTED,
      ]);
      return activeTypes.has(notificationType);
    },

    /**
     * 処理すべき通知かどうかを判定する。
     */
    shouldProcessNotification(notificationType: number): boolean {
      const processTypes: ReadonlySet<number> = new Set<number>([
        SUBSCRIPTION_NOTIFICATION_TYPE.SUBSCRIPTION_RECOVERED,
        SUBSCRIPTION_NOTIFICATION_TYPE.SUBSCRIPTION_RENEWED,
        SUBSCRIPTION_NOTIFICATION_TYPE.SUBSCRIPTION_CANCELED,
        SUBSCRIPTION_NOTIFICATION_TYPE.SUBSCRIPTION_PURCHASED,
        SUBSCRIPTION_NOTIFICATION_TYPE.SUBSCRIPTION_REVOKED,
        SUBSCRIPTION_NOTIFICATION_TYPE.SUBSCRIPTION_EXPIRED,
        SUBSCRIPTION_NOTIFICATION_TYPE.SUBSCRIPTION_RESTARTED,
      ]);
      return processTypes.has(notificationType);
    },
  };
}

export type GooglePlayAdapter = ReturnType<typeof createGooglePlayAdapter>;

// --- ヘルパー ---

function decodeBase64Json(base64: string): Result<unknown> {
  try {
    const decoded = Buffer.from(base64, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded) as unknown;
    return ok(parsed);
  } catch {
    return err({
      code: "BILLING_INVALID_RECEIPT",
      message: "Google Play Pub/Sub メッセージの Base64 デコードに失敗しました",
      retryable: false,
      provider: "google_play",
    });
  }
}
