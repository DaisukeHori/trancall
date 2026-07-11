/**
 * AppleIapAdapter — Apple App Store Server Notifications V2 処理
 *
 * adapters/* 内では型アサーション例外許可（CLAUDE.md より）。
 *
 * - App Store Server Notifications V2 の signedTransactionInfo を解析
 * - 冪等性キー: notificationUUID（Apple 通知固有の UUID。VARCHAR(200) に収まる）
 *   ※ signedTransactionInfo (JWS 全文、数 KB) は webhook_events.external_event_id
 *     (VARCHAR(200)) を超過するため使用しない (#22)
 * - JWS 署名検証は apps/server 側に委ねる（billing adapter はペイロード解析のみ）
 *
 * productId マッピング: iap-adapter.ts の APPLE_IAP_PRODUCT_ID_MAP (canonical) を参照。
 * docs/billing-ui-flow.md §7.2
 *
 * M-8: 本 adapter (`apple-iap-adapter.ts`) と `iap-adapter.ts` は「二重実装」ではなく、
 * 互いに異なる責務を持つ 2 つの独立した adapter である:
 * - `apple-iap-adapter.ts` (本ファイル): Apple → Server の Server-to-Server Webhook 通知
 *   (App Store Server Notifications V2) を解析する。JWS 署名検証は行わない (apps/server が担う)。
 * - `iap-adapter.ts`: Client (StoreKit 2) → Server の Transaction 検証を行う。
 *   x5c 証明書チェーンによる JWS 署名検証を含む (`verifyJwsSignature`)。
 * 旧課題 (sprint3-known-issues.md §2.2) の実体は「productId マッピングが旧形式
 * (`trancall_light_monthly`) と canonical 形式 (`com.trancall.subscription.light.monthly`) の
 * 2 箇所に別々に定義されていたこと」であり、既に解消済み (本ファイルは iap-adapter.ts の
 * `APPLE_IAP_PRODUCT_ID_MAP` を canonical として re-export ではなく直接 import して使う)。
 * 未使用だった重複ヘルパー (`mapProductIdToTier` / `APPLE_PRODUCT_ID_MAP` 再エクスポート) は
 * `iap-adapter.ts` の `resolveTier` / `APPLE_IAP_PRODUCT_ID_MAP` に一本化し削除した。
 */

import { z } from "zod";
import type { Result, AppError } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

import type { PlanTier } from "../schemas.ts";
import { APPLE_IAP_PRODUCT_ID_MAP } from "./iap-adapter.ts";

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

export interface AppleIapWebhookResult {
  /** 冪等性キー（notificationUUID）。#22: signedTransactionInfo は VARCHAR(200) 超過のため不使用 */
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
        idempotencyKey: notification.notificationUUID,
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
