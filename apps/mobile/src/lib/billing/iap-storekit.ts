/**
 * iOS App Store IAP (StoreKit 2) adapter
 *
 * docs/billing-ui-flow.md v1.2 §7 準拠
 * react-native-iap を使い StoreKit 2 Transaction を取得し、
 * recordIapTransaction 経由で server に JWS を送信してサブスクリプションを確定する。
 *
 * iOS のみ。Android は Google Play Billing で別実装。
 */

import { Platform } from "react-native";
import type { Result } from "../result.js";
import { err } from "../result.js";
import type { IapTransactionResult } from "@trancall/billing";

// =============================================================================
// Product ID 定義 (docs/billing-ui-flow.md §7.2)
// =============================================================================

export const IAP_PRODUCT_IDS = {
  light: "com.trancall.subscription.light.monthly",
  standard: "com.trancall.subscription.standard.monthly",
  business: "com.trancall.subscription.business.monthly",
} as const satisfies Record<string, string>;

export type IapProductTier = keyof typeof IAP_PRODUCT_IDS;

/** productId → tier のリバースマップ */
const PRODUCT_ID_TO_TIER: Record<string, IapProductTier> = Object.fromEntries(
  Object.entries(IAP_PRODUCT_IDS).map(([tier, id]) => [id, tier as IapProductTier]),
);

/** productId から tier を解決する */
export function resolveProductTier(productId: string): IapProductTier | null {
  return PRODUCT_ID_TO_TIER[productId] ?? null;
}

// =============================================================================
// react-native-iap の型定義 (型安全なインターフェース)
// =============================================================================

/** react-native-iap の Subscription 型 (最低限のフィールド) */
interface RnIapSubscription {
  productId: string;
  localizedPrice?: string;
  currency?: string;
  title?: string;
  description?: string;
}

/** react-native-iap の Purchase 型 (StoreKit 2 Transaction) */
interface RnIapPurchase {
  productId: string;
  transactionId?: string;
  originalTransactionIdentifierIOS?: string;
  transactionDate?: number;
  /** StoreKit 2 JWS signed transaction (iOS 15+) */
  transactionReceipt?: string;
  /** expo-iap / react-native-iap v12+ の JWS フィールド */
  jwsRepresentation?: string;
}

/** react-native-iap の PurchaseError */
interface RnIapPurchaseError {
  code?: string;
  message?: string;
  userInfo?: Record<string, unknown>;
}

/** react-native-iap モジュールインターフェース */
interface RnIapModule {
  getSubscriptions: (params: { skus: string[] }) => Promise<RnIapSubscription[]>;
  requestSubscription: (params: { sku: string; andDangerouslyFinishTransactionAutomaticallyIOS?: boolean }) => Promise<RnIapPurchase | RnIapPurchase[] | null | undefined>;
  purchaseUpdatedListener: (callback: (purchase: RnIapPurchase) => void) => { remove: () => void };
  purchaseErrorListener: (callback: (error: RnIapPurchaseError) => void) => { remove: () => void };
  finishTransaction: (params: { purchase: RnIapPurchase; isConsumable?: boolean }) => Promise<string | void>;
  initConnection: () => Promise<boolean>;
  endConnection: () => Promise<void>;
}

// =============================================================================
// react-native-iap のダイナミックインポート (iOS のみ)
// Android / テスト環境ではスタブを返す
// =============================================================================

let _rnIapModule: RnIapModule | null = null;

async function getRnIap(): Promise<RnIapModule | null> {
  if (Platform.OS !== "ios") return null;
  if (_rnIapModule != null) return _rnIapModule;

  try {
    // react-native-iap は native module が必要なため、
    // Expo Go / テスト環境では import エラーになる場合がある
    const mod = await import("react-native-iap");
    _rnIapModule = mod as unknown as RnIapModule;
    return _rnIapModule;
  } catch {
    // react-native-iap が未インストール or native build 前の場合
    return null;
  }
}

// =============================================================================
// IapTransactionResult 変換
// =============================================================================

/**
 * react-native-iap の Purchase から IapTransactionResult に変換する。
 * signedJws は jwsRepresentation (v12+) または transactionReceipt を使用。
 */
function toIapTransactionResult(
  purchase: RnIapPurchase,
): IapTransactionResult | null {
  const signedJws = purchase.jwsRepresentation ?? purchase.transactionReceipt;
  if (signedJws == null || signedJws === "") {
    return null;
  }

  const originalTransactionId =
    purchase.originalTransactionIdentifierIOS ??
    purchase.transactionId ??
    "";
  if (originalTransactionId === "") {
    return null;
  }

  const purchaseDateMs =
    purchase.transactionDate != null ? purchase.transactionDate : Date.now();
  const purchaseDate = new Date(purchaseDateMs).toISOString();

  return {
    originalTransactionId,
    productId: purchase.productId,
    purchaseDate,
    expirationDate: null, // server 側で JWS から取得
    signedJws,
    isUpgrade: false, // server 側で判定
  };
}

// =============================================================================
// IAP 価格取得
// =============================================================================

export interface IapProductInfo {
  productId: string;
  tier: IapProductTier;
  localizedPrice: string;
  currency: string;
  title: string;
}

/**
 * App Store から IAP 商品の価格情報を取得する。
 * docs/billing-ui-flow.md §7.4 Step 1
 *
 * iOS のみ。非 iOS 環境では空配列を返す。
 */
export async function getIapProducts(): Promise<Result<IapProductInfo[]>> {
  if (Platform.OS !== "ios") {
    return { ok: true, data: [] };
  }

  const rnIap = await getRnIap();
  if (rnIap == null) {
    return err({
      code: "BILLING_CHANNEL_NOT_AVAILABLE",
      message: "react-native-iap is not available",
      retryable: false,
    });
  }

  try {
    await rnIap.initConnection();
    const subscriptions = await rnIap.getSubscriptions({
      skus: Object.values(IAP_PRODUCT_IDS),
    });

    const products: IapProductInfo[] = subscriptions
      .map((sub) => {
        const tier = resolveProductTier(sub.productId);
        if (tier == null) return null;
        return {
          productId: sub.productId,
          tier,
          localizedPrice: sub.localizedPrice ?? "",
          currency: sub.currency ?? "JPY",
          title: sub.title ?? "",
        };
      })
      .filter((p): p is IapProductInfo => p != null);

    return { ok: true, data: products };
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Failed to get IAP products";
    return err({
      code: "BILLING_CHANNEL_NOT_AVAILABLE",
      message,
      retryable: true,
    });
  }
}

// =============================================================================
// 購入フロー
// =============================================================================

export interface IapTransactionResultValue {
  transaction: IapTransactionResult;
  tier: IapProductTier;
}

/**
 * IAP サブスクリプション購入を実行する。
 * docs/billing-ui-flow.md §7.4 Step 2-3
 *
 * - `requestSubscription` で iOS native 決済 UI を表示
 * - Transaction 受信後に `IapTransactionResult` に変換して返す
 * - iOS のみ (Android は Google Play Billing で別実装)
 *
 * @param productId - IAP_PRODUCT_IDS のいずれかの値
 */
export async function purchasePlan(
  productId: string,
): Promise<Result<IapTransactionResultValue>> {
  if (Platform.OS !== "ios") {
    return err({
      code: "BILLING_CHANNEL_NOT_AVAILABLE",
      message: "IAP StoreKit is iOS only",
      retryable: false,
    });
  }

  const tier = resolveProductTier(productId);
  if (tier == null) {
    return err({
      code: "BILLING_CHANNEL_NOT_AVAILABLE",
      message: `Invalid productId: ${productId}`,
      retryable: false,
    });
  }

  const rnIap = await getRnIap();
  if (rnIap == null) {
    return err({
      code: "BILLING_CHANNEL_NOT_AVAILABLE",
      message: "react-native-iap is not available in this environment",
      retryable: false,
    });
  }

  try {
    await rnIap.initConnection();

    // requestSubscription は Promise で Purchase を返す (react-native-iap v12+)
    // andDangerouslyFinishTransactionAutomaticallyIOS=false → 手動 finishTransaction
    const purchaseResult = await rnIap.requestSubscription({
      sku: productId,
      andDangerouslyFinishTransactionAutomaticallyIOS: false,
    });

    // 返値は Purchase | Purchase[] | null
    const purchase = Array.isArray(purchaseResult)
      ? purchaseResult[0]
      : purchaseResult;

    if (purchase == null) {
      return err({
        code: "BILLING_PAYMENT_FAILED",
        message: "No purchase returned from StoreKit",
        retryable: true,
      });
    }

    const txResult = toIapTransactionResult(purchase);
    if (txResult == null) {
      return err({
        code: "BILLING_IAP_RECEIPT_INVALID",
        message: "Failed to extract JWS from StoreKit transaction",
        retryable: false,
      });
    }

    // server 検証後に finishTransaction を呼ぶことを呼び出し元に委ねるため、
    // ここでは purchase オブジェクトを使い finishTransaction は呼ばない。
    // (docs/billing-ui-flow.md §7.4 Step 4-5 完了後に呼ぶ)

    return {
      ok: true,
      data: {
        transaction: txResult,
        tier,
      },
    };
  } catch (e: unknown) {
    return mapIapError(e);
  }
}

/**
 * server 検証成功後に App Store に Transaction の完了を通知する。
 * docs/billing-ui-flow.md §7.4 Step 5
 *
 * @param productId - 購入した productId (finishTransaction の識別に必要)
 */
export async function finishIapTransaction(
  originalTransactionId: string,
  productId: string,
): Promise<void> {
  if (Platform.OS !== "ios") return;

  const rnIap = await getRnIap();
  if (rnIap == null) return;

  try {
    // 最小限の purchase オブジェクトで finishTransaction を呼ぶ
    await rnIap.finishTransaction({
      purchase: {
        productId,
        originalTransactionIdentifierIOS: originalTransactionId,
        transactionId: originalTransactionId,
      },
      isConsumable: false,
    });
  } catch {
    // finishTransaction 失敗は非致命的 — App Store が次回起動時に再試行するため
    // エラーはサイレントに無視する
  }
}

// =============================================================================
// 購入復元 (Restore Purchases)
// docs/billing-ui-flow.md §12
// =============================================================================

/**
 * StoreKit.Transaction.currentEntitlements から現在有効な transactions を列挙する。
 * docs/billing-ui-flow.md §12 Restore Purchases フロー
 *
 * iOS のみ。非 iOS 環境では空配列を返す。
 */
export async function getRestoredTransactions(): Promise<
  Result<IapTransactionResult[]>
> {
  if (Platform.OS !== "ios") {
    return { ok: true, data: [] };
  }

  const rnIap = await getRnIap();
  if (rnIap == null) {
    return err({
      code: "BILLING_CHANNEL_NOT_AVAILABLE",
      message: "react-native-iap is not available",
      retryable: false,
    });
  }

  try {
    await rnIap.initConnection();

    // react-native-iap では getAvailablePurchases() で復元可能な purchases を取得
    // 型安全のため dynamic import で取得
    const mod = await import("react-native-iap");
    const iapMod = mod as unknown as {
      getAvailablePurchases: () => Promise<RnIapPurchase[]>;
    };

    if (typeof iapMod.getAvailablePurchases !== "function") {
      return { ok: true, data: [] };
    }

    const availablePurchases = await iapMod.getAvailablePurchases();

    const transactions: IapTransactionResult[] = availablePurchases
      .filter(
        (p) =>
          resolveProductTier(p.productId) != null,
      )
      .map(toIapTransactionResult)
      .filter((t): t is IapTransactionResult => t != null);

    return { ok: true, data: transactions };
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Failed to restore purchases";
    return err({
      code: "BILLING_IAP_RECEIPT_INVALID",
      message,
      retryable: false,
    });
  }
}

// =============================================================================
// Error mapping
// docs/billing-ui-flow.md §7.5
// =============================================================================

function mapIapError(e: unknown): Result<never> {
  if (e != null && typeof e === "object") {
    const error = e as Record<string, unknown>;
    const code = typeof error["code"] === "string" ? error["code"] : "";

    // ユーザーがキャンセル (docs/billing-ui-flow.md §7.5)
    if (
      code === "E_USER_CANCELLED" ||
      code === "2" // SKErrorDomain 2 = payment cancelled
    ) {
      return err({
        code: "E_USER_CANCELLED",
        message: "Purchase cancelled by user",
        retryable: false,
      });
    }

    // 支払い失敗 (カード不足等)
    if (
      code === "E_PURCHASE_ERROR" ||
      code === "E_PAYMENT_INVALID" ||
      code === "E_PAYMENT_NOT_ALLOWED"
    ) {
      return err({
        code: "BILLING_PAYMENT_FAILED",
        message:
          typeof error["message"] === "string"
            ? error["message"]
            : "Payment failed",
        retryable: true,
      });
    }

    // 商品が無効
    if (code === "E_ITEM_UNAVAILABLE" || code === "E_UNKNOWN") {
      return err({
        code: "BILLING_CHANNEL_NOT_AVAILABLE",
        message:
          typeof error["message"] === "string"
            ? error["message"]
            : "Product unavailable",
        retryable: false,
      });
    }
  }

  const message =
    e instanceof Error ? e.message : "Unknown IAP error";
  return err({
    code: "BILLING_PAYMENT_FAILED",
    message,
    retryable: true,
  });
}
