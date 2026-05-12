/**
 * AppleIapAdapter — Apple App Store Server Notifications V2 処理
 *
 * adapters/* 内では型アサーション例外許可（CLAUDE.md より）。
 *
 * - App Store Server Notifications V2 の signedTransactionInfo を解析
 * - 冪等性キー: signedTransactionInfo（JWT トークン文字列）
 * - JWS 署名検証は apps/server 側に委ねる（billing adapter はペイロード解析のみ）
 *
 * productId マッピング: iap-adapter.ts の APPLE_IAP_PRODUCT_ID_MAP (canonical) を参照。
 * docs/billing-ui-flow.md §7.2
 */

import { z } from "zod";
import type { Result, AppError } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

import type { PlanTier } from "../schemas.js";
import { APPLE_IAP_PRODUCT_ID_MAP } from "./iap-adapter.js";

// Apple App Store Server Notifications V2 ペイロードスキーマ
// https://developer.apple.com/documentation/appstoreservernotifications
const AppleNotificationPayloadSchema = z.object({
  notificationType: z.string(),
  subtype: z.string().optional(),
  notificationUUID: z.string(),
  data: z.object({
    bundleId: z.string(),
    bundleVersion: z.string().optional(),
    environment: z.enum(["Sandbox", "Production"]),
    signedTransactionInfo: z.string(), // JWS
    signedRenewalInfo: z.string().optional(),
  }),
  version: z.string(),
  signedDate: z.number(),
});

// JWS デコード後のトランザクション情報スキーマ
const AppleTransactionInfoSchema = z.object({
  transactionId: z.string(),
  originalTransactionId: z.string(),
  bundleId: z.string(),
  productId: z.string(),
  purchaseDate: z.number(),
  originalPurchaseDate: z.number(),
  expiresDate: z.number().optional(),
  type: z.string().optional(), // "Auto-Renewable Subscription"
  environment: z.string().optional(),
});

/**
 * Apple 製品 ID → PlanTier マッピング (後方互換 re-export)。
 * canonical 定義は iap-adapter.ts の APPLE_IAP_PRODUCT_ID_MAP。
 * Webhook 処理 (本 adapter) と Transaction 検証 (iap-adapter.ts) の両方で
 * 同一の canonical productId 形式 `com.trancall.subscription.{light,standard,business}.monthly` を使用する。
 * docs/billing-ui-flow.md §7.2
 */
export const APPLE_PRODUCT_ID_MAP: Record<string, PlanTier> = APPLE_IAP_PRODUCT_ID_MAP;

export interface AppleIapWebhookResult {
  /** 冪等性キー（signedTransactionInfo） */
  idempotencyKey: string;
  notificationType: string;
  originalTransactionId: string;
  productId: string;
  tier: PlanTier;
  expiresDate: string | null;
  environment: "Sandbox" | "Production";
}

export function createAppleIapAdapter() {
  return {
    /**
     * Apple App Store Server Notifications V2 ペイロードを解析する。
     *
     * @param payload 未検証の受信ペイロード（Zod でバリデーション）
     * @returns 解析済みの Webhook 情報。JWS デコードはここでは行わない（簡易版）。
     */
    parseWebhookPayload(
      payload: unknown,
    ): Result<AppleIapWebhookResult> {
      const parsed = AppleNotificationPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        return err({
          code: "BILLING_INVALID_RECEIPT",
          message: "Apple 通知ペイロードの形式が不正です",
          retryable: false,
          httpStatus: 400,
          provider: "apple_iap",
          details: { issues: parsed.error.issues.map((i) => i.message) },
        });
      }

      const notification = parsed.data;
      const signedTransactionInfo = notification.data.signedTransactionInfo;

      // JWS のペイロード部分（Base64URL デコード）を取得
      // 署名検証は apps/server 側に委ねるため、ここではペイロードのみデコード
      const transactionResult = decodeJwsPayload(signedTransactionInfo);
      if (!transactionResult.ok) return transactionResult;

      const transaction = transactionResult.data;
      const tier = APPLE_IAP_PRODUCT_ID_MAP[transaction.productId];
      if (tier === undefined) {
        return err({
          code: "BILLING_INVALID_RECEIPT",
          message: `未知の Apple 製品 ID: ${transaction.productId}`,
          retryable: false,
          provider: "apple_iap",
        });
      }

      const expiresDate =
        transaction.expiresDate !== undefined
          ? new Date(transaction.expiresDate).toISOString()
          : null;

      return ok({
        idempotencyKey: signedTransactionInfo,
        notificationType: notification.notificationType,
        originalTransactionId: transaction.originalTransactionId,
        productId: transaction.productId,
        tier,
        expiresDate,
        environment: notification.data.environment,
      });
    },

    /**
     * 通知タイプから処理すべきかを判定する。
     * SUBSCRIBED / DID_RENEW → プラン更新
     * DID_FAIL_TO_RENEW / EXPIRED / REVOKE → サブスク終了
     */
    shouldProcessNotification(notificationType: string): boolean {
      const processTypes = new Set([
        "SUBSCRIBED",
        "DID_RENEW",
        "DID_CHANGE_RENEWAL_PREF",
        "DID_FAIL_TO_RENEW",
        "EXPIRED",
        "REVOKE",
      ]);
      return processTypes.has(notificationType);
    },

    /**
     * notificationType からサブスクリプションのアクティブ状態を判定する。
     */
    isActive(notificationType: string): boolean {
      return notificationType === "SUBSCRIBED" || notificationType === "DID_RENEW";
    },

    /**
     * productId を PlanTier にマッピングする。
     * 未知の productId は BILLING_IAP_RECEIPT_INVALID を返す。
     */
    mapProductIdToTier(productId: string): Result<PlanTier> {
      const tier = APPLE_IAP_PRODUCT_ID_MAP[productId];
      if (!tier) {
        return err({
          code: "BILLING_IAP_RECEIPT_INVALID",
          message: `未知の Apple 製品 ID: ${productId}`,
          retryable: false,
          provider: "apple_iap",
        });
      }
      return ok(tier);
    },
  };
}

export type AppleIapAdapter = ReturnType<typeof createAppleIapAdapter>;

// --- JWS ペイロードデコード（署名検証なし） ---

function decodeJwsPayload(
  jws: string,
): Result<z.infer<typeof AppleTransactionInfoSchema>, AppError> {
  const parts = jws.split(".");
  if (parts.length !== 3) {
    return err({
      code: "BILLING_INVALID_RECEIPT",
      message: "Apple JWS の形式が不正です（3パート必須）",
      retryable: false,
      provider: "apple_iap",
    });
  }

  // Base64URL デコード
  const payloadPart = parts[1];
  if (payloadPart === undefined) {
    return err({
      code: "BILLING_INVALID_RECEIPT",
      message: "Apple JWS ペイロード部が存在しません",
      retryable: false,
      provider: "apple_iap",
    });
  }

  let rawJson: unknown;
  try {
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const jsonString = Buffer.from(base64, "base64").toString("utf-8");
    rawJson = JSON.parse(jsonString) as unknown;
  } catch {
    return err({
      code: "BILLING_INVALID_RECEIPT",
      message: "Apple JWS ペイロードの Base64URL デコードに失敗しました",
      retryable: false,
      provider: "apple_iap",
    });
  }

  const result = AppleTransactionInfoSchema.safeParse(rawJson);
  if (!result.success) {
    return err({
      code: "BILLING_INVALID_RECEIPT",
      message: "Apple トランザクション情報のスキーマ検証に失敗しました",
      retryable: false,
      provider: "apple_iap",
      details: { issues: result.error.issues.map((i) => i.message) },
    });
  }

  return ok(result.data);
}
