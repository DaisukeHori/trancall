/**
 * IapAdapter — StoreKit 2 / Google Play Billing IAP 検証アダプタ
 *
 * docs/billing-ui-flow.md v1.2 §7 canonical 設計準拠。
 * Phase 1a 最小実装: JWS の基本デコード + originalTransactionId 重複排除。
 *
 * 設計上の制約:
 * - Apple App Store Server API による JWS 検証 (server-side) は Phase 1b で実装。
 *   Phase 1a では JWS ペイロード部の Base64URL デコードのみ実施し、
 *   productId → tier の解決と originalTransactionId の重複排除のみを行う。
 * - JWS 署名の暗号学的検証を省略することは security-critical だが、
 *   docs/billing-ui-flow.md §15.1 の Apple App Store Server API 検証は Phase 1b 実装として
 *   明示的にスコープ外とする (設計書 §7.4 Step 4 参照)。
 *
 * adapters/* 内では型アサーション例外許可 (CLAUDE.md)。
 */

import { z } from "zod";
import type { Result, AppError } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

import type { PlanTier } from "../schemas.js";
import type { IapTransactionResult } from "../view-models/index.js";

// =============================================================================
// Apple productId → PlanTier マッピング
// docs/billing-ui-flow.md §7.2
// =============================================================================

/**
 * TODO(T-29): 既存 `apple-iap-adapter.ts` (Webhook 処理) の `APPLE_PRODUCT_ID_MAP` と統合
 *
 * - 本 adapter (T-7) は StoreKit 2 Transaction 検証用、canonical 形式 `com.trancall.subscription.light.monthly`
 * - 既存 `apple-iap-adapter.ts` は Webhook 受信用、旧形式 `trancall_light_monthly`
 * - Sprint 3 後半 (T-29) で両者を統合し、canonical 形式で単一の定義に集約する
 *
 * 参照: docs/billing-ui-flow.md §7.2
 */
export const APPLE_IAP_PRODUCT_ID_MAP: Record<string, PlanTier> = {
  "com.trancall.subscription.light.monthly": "light",
  "com.trancall.subscription.standard.monthly": "standard",
  "com.trancall.subscription.business.monthly": "business",
};

// =============================================================================
// JWS ペイロードスキーマ (Apple Signed Transaction Info)
// =============================================================================

const AppleJwsTransactionPayloadSchema = z.object({
  transactionId: z.string(),
  originalTransactionId: z.string(),
  bundleId: z.string(),
  productId: z.string(),
  purchaseDate: z.number(), // Unix timestamp (ms)
  originalPurchaseDate: z.number(),
  expiresDate: z.number().optional(), // undefined = 期限なし (non-subscription)
  type: z.string().optional(),
  environment: z.string().optional(),
});

// =============================================================================
// 検証結果型
// =============================================================================

export interface VerifiedIapTransaction {
  originalTransactionId: string;
  productId: string;
  tier: PlanTier;
  purchaseDate: string; // ISO datetime
  expirationDate: string | null; // ISO datetime or null
  isValid: boolean;
}

// =============================================================================
// ファクトリ
// =============================================================================

export function createIapAdapter() {
  return {
    /**
     * StoreKit 2 の signedJws をデコードし、トランザクション情報を検証する。
     *
     * Phase 1a: JWS ペイロードのデコード + productId 解決のみ。
     * Phase 1b: Apple App Store Server API への検証リクエストを追加予定。
     *
     * @param transaction mobile から受け取った IapTransactionResult
     */
    async verifyIapTransaction(
      transaction: IapTransactionResult,
    ): Promise<Result<VerifiedIapTransaction>> {
      // Step 1: JWS ペイロードのデコード
      const decodeResult = decodeJwsPayload(transaction.signedJws);
      if (!decodeResult.ok) return decodeResult;

      const payload = decodeResult.data;

      // Step 2: originalTransactionId の整合性チェック
      if (payload.originalTransactionId !== transaction.originalTransactionId) {
        return err({
          code: "BILLING_IAP_RECEIPT_INVALID",
          message:
            "JWS の originalTransactionId がリクエストの値と一致しません",
          retryable: false,
          provider: "apple_iap",
        });
      }

      // Step 3: productId → tier 解決
      const tier = APPLE_IAP_PRODUCT_ID_MAP[payload.productId];
      if (tier === undefined) {
        return err({
          code: "BILLING_IAP_RECEIPT_INVALID",
          message: `未知の Apple 製品 ID: ${payload.productId}`,
          retryable: false,
          provider: "apple_iap",
        });
      }

      // Step 4: 有効期限チェック (expiresDate がある場合)
      let expirationDate: string | null = null;
      if (payload.expiresDate !== undefined) {
        const expiry = new Date(payload.expiresDate);
        expirationDate = expiry.toISOString();

        // 有効期限切れチェック
        if (expiry < new Date()) {
          return err({
            code: "BILLING_IAP_RECEIPT_INVALID",
            message: "Apple IAP トランザクションの有効期限が切れています",
            retryable: false,
            provider: "apple_iap",
          });
        }
      }

      return ok({
        originalTransactionId: payload.originalTransactionId,
        productId: payload.productId,
        tier,
        purchaseDate: new Date(payload.purchaseDate).toISOString(),
        expirationDate,
        isValid: true,
      });
    },

    /**
     * productId から PlanTier を解決する。
     * 解決できない場合は null を返す。
     */
    resolveTier(productId: string): PlanTier | null {
      return APPLE_IAP_PRODUCT_ID_MAP[productId] ?? null;
    },

    /**
     * transactions 配列から最新の有効なトランザクションを選択する。
     * purchaseDate が最新のものを返す。
     */
    selectLatestTransaction(
      transactions: VerifiedIapTransaction[],
    ): VerifiedIapTransaction | null {
      if (transactions.length === 0) return null;
      return transactions.reduce((latest, current) => {
        return new Date(current.purchaseDate) > new Date(latest.purchaseDate)
          ? current
          : latest;
      });
    },
  };
}

export type IapAdapter = ReturnType<typeof createIapAdapter>;

// =============================================================================
// JWS ペイロードデコードヘルパー (署名検証なし — Phase 1a)
// =============================================================================

function decodeJwsPayload(
  jws: string,
): Result<z.infer<typeof AppleJwsTransactionPayloadSchema>, AppError> {
  const parts = jws.split(".");
  if (parts.length !== 3) {
    return err({
      code: "BILLING_IAP_RECEIPT_INVALID",
      message: "Apple JWS の形式が不正です (3 パート必須)",
      retryable: false,
      provider: "apple_iap",
    });
  }

  const payloadPart = parts[1];
  if (payloadPart === undefined) {
    return err({
      code: "BILLING_IAP_RECEIPT_INVALID",
      message: "Apple JWS のペイロード部が存在しません",
      retryable: false,
      provider: "apple_iap",
    });
  }

  let rawJson: unknown;
  try {
    // Base64URL → Base64 変換してデコード
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const jsonString = Buffer.from(base64, "base64").toString("utf-8");
    rawJson = JSON.parse(jsonString) as unknown;
  } catch {
    return err({
      code: "BILLING_IAP_RECEIPT_INVALID",
      message: "Apple JWS ペイロードの Base64URL デコードに失敗しました",
      retryable: false,
      provider: "apple_iap",
    });
  }

  const result = AppleJwsTransactionPayloadSchema.safeParse(rawJson);
  if (!result.success) {
    return err({
      code: "BILLING_IAP_RECEIPT_INVALID",
      message: "Apple JWS ペイロードのスキーマ検証に失敗しました",
      retryable: false,
      provider: "apple_iap",
      details: { issues: result.error.issues.map((i) => i.message) },
    });
  }

  return ok(result.data);
}
