/**
 * IapAdapter — StoreKit 2 / Google Play Billing IAP 検証アダプタ
 *
 * docs/billing-ui-flow.md v1.2 §7 canonical 設計準拠。
 *
 * JWS (signedJws) の検証は以下の 2 段階で行う:
 *   1. header.x5c 証明書チェーンによる署名検証 (verifyJwsSignature)
 *      - チェーン内の各証明書が「直下の証明書の公開鍵」で署名されていることを確認
 *      - leaf 証明書の公開鍵で JWS 本体 (header.payload) の署名を検証し、改竄を検知する
 *      - config.trustedRootCertsPem を指定した場合のみ、チェーン最上位証明書が
 *        信頼済みルート証明書と一致するかを確認する (root pinning)
 *   2. ペイロードのデコード + productId → tier 解決 + bundleId/environment 突合
 *
 * 【既知の制約 / TODO】
 * - config.trustedRootCertsPem を渡さない場合、ルート証明書が本物の Apple Root CA
 *   (https://www.apple.com/certificateauthority/) であることまでは検証しない
 *   (チェーン内の署名リンクの整合性のみ検証する)。本番環境では必ず
 *   trustedRootCertsPem に Apple Root CA - G3 の PEM を設定すること。
 * - 証明書の失効確認 (OCSP/CRL) は未実装。
 *
 * adapters/* 内では型アサーション例外許可 (CLAUDE.md)。
 */

import crypto from "crypto";
import { z } from "zod";
import type { Result, AppError } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

import type { PlanTier } from "../schemas.js";
import type { IapTransactionResult } from "../view-models/index.js";

// =============================================================================
// Apple productId → PlanTier マッピング (canonical 定義)
// docs/billing-ui-flow.md §7.2
// Webhook 処理 (apple-iap-adapter.ts) と Transaction 検証 (本 adapter) の両方がここを参照する。
// =============================================================================

/**
 * Apple IAP productId → PlanTier の canonical マッピング。
 * Webhook 受信 (apple-iap-adapter.ts) と StoreKit 2 Transaction 検証 (本 adapter) の
 * 両方がこの定数を参照することで、全 IAP 経路で同一のマッピングを保証する。
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
// アダプタ設定
// =============================================================================

export interface IapAdapterConfig {
  /** 期待する Apple bundleId。JWS payload の bundleId と照合する (指定時のみ)。 */
  bundleId?: string;
  /** 期待する environment。JWS payload の environment と照合する (指定時のみ)。 */
  environment?: "Sandbox" | "Production";
  /**
   * 信頼済み Apple Root CA 証明書 (PEM 形式) の配列。
   * 指定時は x5c チェーン最上位証明書の fingerprint がこのリストのいずれかと
   * 一致することを検証する (root pinning)。省略時はチェーン内署名リンクの
   * 整合性のみ検証し、ルート証明書の真正性は検証しない (JSDoc 冒頭の制約参照)。
   */
  trustedRootCertsPem?: string[];
}

// =============================================================================
// ファクトリ
// =============================================================================

export function createIapAdapter(config: IapAdapterConfig = {}) {
  return {
    /**
     * StoreKit 2 の signedJws を検証し、トランザクション情報を返す。
     *
     * - x5c 証明書チェーンによる JWS 署名検証 (改竄検知)
     * - bundleId / environment の config 突合
     * - productId → tier 解決 + 有効期限チェック
     *
     * @param transaction mobile から受け取った IapTransactionResult
     */
    async verifyIapTransaction(
      transaction: IapTransactionResult,
    ): Promise<Result<VerifiedIapTransaction>> {
      // Step 0: JWS 署名検証 (x5c チェーン)
      const sigResult = verifyJwsSignature(transaction.signedJws, config);
      if (!sigResult.ok) return sigResult;

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

      // Step 2.5: bundleId / environment の config 突合
      if (config.bundleId !== undefined && payload.bundleId !== config.bundleId) {
        return err({
          code: "BILLING_IAP_RECEIPT_INVALID",
          message: "JWS の bundleId が想定と一致しません",
          retryable: false,
          provider: "apple_iap",
        });
      }
      if (
        config.environment !== undefined &&
        payload.environment !== undefined &&
        payload.environment !== config.environment
      ) {
        return err({
          code: "BILLING_IAP_RECEIPT_INVALID",
          message: "JWS の environment が想定と一致しません",
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
// JWS 署名検証ヘルパー (x5c 証明書チェーン)
// =============================================================================

const JwsHeaderSchema = z.object({
  alg: z.string(),
  x5c: z.array(z.string()).optional(),
});

function base64UrlToBuffer(input: string): Buffer {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64");
}

/**
 * JWS の x5c 証明書チェーンを検証し、leaf 証明書の公開鍵で署名を検証する。
 *
 * 1. header.x5c の各証明書が「直下の証明書の公開鍵」で署名されていることを確認する
 *    (certs[i] は certs[i+1] によって発行されている必要がある)
 * 2. config.trustedRootCertsPem が指定されている場合、チェーン最上位の証明書が
 *    信頼済みルート証明書のいずれかと一致することを確認する (root pinning)
 * 3. leaf 証明書 (certs[0]) の公開鍵で JWS 本体 (header.payload) の署名を検証する
 *
 * #23: apps/server の Apple App Store Server Notifications V2 Webhook
 * (signedPayload JWS) の署名検証にも再利用するため named export にしている。
 * StoreKit 2 クライアント JWS も Webhook の signedPayload も同じ ES256 + x5c 形式のため
 * 共通の検証ロジックで扱える (ペイロードのスキーマのみ呼び出し側で異なる)。
 */
export function verifyJwsSignature(
  jws: string,
  config: IapAdapterConfig,
): Result<void, AppError> {
  const parts = jws.split(".");
  if (parts.length !== 3) {
    return err({
      code: "BILLING_IAP_RECEIPT_INVALID",
      message: "Apple JWS の形式が不正です (3 パート必須)",
      retryable: false,
      provider: "apple_iap",
    });
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  if (headerPart === undefined || payloadPart === undefined || signaturePart === undefined) {
    return err({
      code: "BILLING_IAP_RECEIPT_INVALID",
      message: "Apple JWS のパートが不正です",
      retryable: false,
      provider: "apple_iap",
    });
  }

  let headerJson: unknown;
  try {
    headerJson = JSON.parse(base64UrlToBuffer(headerPart).toString("utf-8")) as unknown;
  } catch {
    return err({
      code: "BILLING_IAP_RECEIPT_INVALID",
      message: "Apple JWS ヘッダーのデコードに失敗しました",
      retryable: false,
      provider: "apple_iap",
    });
  }

  const headerResult = JwsHeaderSchema.safeParse(headerJson);
  if (!headerResult.success) {
    return err({
      code: "BILLING_IAP_RECEIPT_INVALID",
      message: "Apple JWS ヘッダーの形式が不正です",
      retryable: false,
      provider: "apple_iap",
    });
  }
  const header = headerResult.data;

  if (header.alg !== "ES256") {
    return err({
      code: "BILLING_IAP_RECEIPT_INVALID",
      message: `未対応の JWS 署名アルゴリズムです: ${header.alg} (ES256 のみサポート)`,
      retryable: false,
      provider: "apple_iap",
    });
  }

  if (header.x5c === undefined || header.x5c.length === 0) {
    return err({
      code: "BILLING_IAP_RECEIPT_INVALID",
      message: "Apple JWS ヘッダーに x5c 証明書チェーンがありません",
      retryable: false,
      provider: "apple_iap",
    });
  }

  let certs: crypto.X509Certificate[];
  try {
    certs = header.x5c.map(
      (certBase64) => new crypto.X509Certificate(Buffer.from(certBase64, "base64")),
    );
  } catch {
    return err({
      code: "BILLING_IAP_RECEIPT_INVALID",
      message: "x5c 証明書のパースに失敗しました",
      retryable: false,
      provider: "apple_iap",
    });
  }

  // チェーン内リンク検証: certs[i] は certs[i+1] の公開鍵で発行されている必要がある
  for (let i = 0; i < certs.length - 1; i++) {
    const cert = certs[i];
    const issuer = certs[i + 1];
    if (cert === undefined || issuer === undefined || !cert.verify(issuer.publicKey)) {
      return err({
        code: "BILLING_IAP_RECEIPT_INVALID",
        message: "x5c 証明書チェーンの署名検証に失敗しました",
        retryable: false,
        provider: "apple_iap",
      });
    }
  }

  // ルート証明書の信頼性確認 (root pinning; config.trustedRootCertsPem 指定時のみ)
  if (config.trustedRootCertsPem !== undefined && config.trustedRootCertsPem.length > 0) {
    const topCert = certs[certs.length - 1];
    if (topCert === undefined) {
      return err({
        code: "BILLING_IAP_RECEIPT_INVALID",
        message: "x5c チェーンが空です",
        retryable: false,
        provider: "apple_iap",
      });
    }
    const isTrusted = config.trustedRootCertsPem.some((pem) => {
      try {
        const rootCert = new crypto.X509Certificate(pem);
        return topCert.fingerprint256 === rootCert.fingerprint256;
      } catch {
        return false;
      }
    });
    if (!isTrusted) {
      return err({
        code: "BILLING_IAP_RECEIPT_INVALID",
        message: "x5c チェーンのルート証明書が信頼済みリストにありません",
        retryable: false,
        provider: "apple_iap",
      });
    }
  }

  // leaf 証明書の公開鍵で JWS 署名 (header.payload) を検証する (改竄検知)
  const leaf = certs[0];
  if (leaf === undefined) {
    return err({
      code: "BILLING_IAP_RECEIPT_INVALID",
      message: "leaf 証明書が取得できません",
      retryable: false,
      provider: "apple_iap",
    });
  }

  const signingInput = Buffer.from(`${headerPart}.${payloadPart}`);
  const signature = base64UrlToBuffer(signaturePart);

  let verified: boolean;
  try {
    verified = crypto.verify(
      "sha256",
      signingInput,
      { key: leaf.publicKey, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch {
    verified = false;
  }

  if (!verified) {
    return err({
      code: "BILLING_IAP_RECEIPT_INVALID",
      message: "Apple JWS 署名の検証に失敗しました (改竄の可能性があります)",
      retryable: false,
      provider: "apple_iap",
    });
  }

  return ok(undefined);
}

// =============================================================================
// JWS ペイロードデコードヘルパー (署名検証は verifyJwsSignature で実施済み)
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
