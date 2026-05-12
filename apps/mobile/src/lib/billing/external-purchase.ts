/**
 * StoreKit External Purchase adapter
 *
 * docs/billing-ui-flow.md v1.2 §8 準拠
 * Apple StoreKit External Link Entitlement を使用した外部決済リンクフロー。
 * 日本・EU・韓国・インド等の対象国向け。
 *
 * iOS のみ。Android は通常 IAP を使用する。
 * Entitlement 未取得時は Stripe Web Checkout (T-42) にフォールバックする。
 */

import { Linking, Platform } from "react-native";
import { getLocales } from "expo-localization";
import type { Result } from "../result.js";
import { err } from "../result.js";

// =============================================================================
// 対象国リスト (docs/billing-ui-flow.md §8.1)
// =============================================================================

/**
 * StoreKit External Purchase が利用可能な地域コード
 * Apple MSCA (Mobile Software Competition Act) / DMA 対象国
 *
 * docs/billing-ui-flow.md §8.1 + §8.3 Step 1
 */
export const EXTERNAL_PURCHASE_ELIGIBLE_REGIONS = new Set([
  "JP", // 日本 (MSCA)
  "DE", // ドイツ (EU DMA)
  "FR", // フランス
  "IT", // イタリア
  "ES", // スペイン
  "NL", // オランダ
  "PL", // ポーランド
  "SE", // スウェーデン
  "BE", // ベルギー
  "AT", // オーストリア
  "DK", // デンマーク
  "FI", // フィンランド
  "PT", // ポルトガル
  "CZ", // チェコ
  "HU", // ハンガリー
  "RO", // ルーマニア
  "SK", // スロバキア
  "BG", // ブルガリア
  "HR", // クロアチア
  "EE", // エストニア
  "LV", // ラトビア
  "LT", // リトアニア
  "LU", // ルクセンブルク
  "MT", // マルタ
  "CY", // キプロス
  "SI", // スロベニア
  "IE", // アイルランド
  "GR", // ギリシャ
  "KR", // 韓国
  "IN", // インド
  "AU", // オーストラリア (2025 規制解放)
]);

/**
 * 現在のロケールが External Purchase 対象国かどうかを判定する。
 * docs/billing-ui-flow.md §8.3 Step 1
 *
 * @returns true if the user's region is eligible for External Purchase
 */
export function isExternalPurchaseEligible(): boolean {
  if (Platform.OS !== "ios") return false;

  const locales = getLocales();
  const regionCode = locales[0]?.regionCode;
  if (regionCode == null) return false;

  return EXTERNAL_PURCHASE_ELIGIBLE_REGIONS.has(regionCode.toUpperCase());
}

// =============================================================================
// ExternalPurchaseLink (iOS 17.4+) のダイナミックインポート
// =============================================================================

/**
 * StoreKit.ExternalPurchaseLink (iOS 17.4+) の型インターフェース
 * Apple External Link Entitlement 取得後に動作する。
 */
interface ExternalPurchaseLinkModule {
  open: (url: string) => Promise<void>;
  isEligible?: () => Promise<boolean>;
}

let _externalPurchaseLinkModule: ExternalPurchaseLinkModule | null | undefined =
  undefined; // undefined = 未チェック, null = 利用不可

async function getExternalPurchaseLinkModule(): Promise<ExternalPurchaseLinkModule | null> {
  // 結果をキャッシュ
  if (_externalPurchaseLinkModule !== undefined) {
    return _externalPurchaseLinkModule;
  }

  if (Platform.OS !== "ios") {
    _externalPurchaseLinkModule = null;
    return null;
  }

  try {
    // react-native-iap または expo-iap が ExternalPurchaseLink を提供する場合
    const mod = await import("react-native-iap");
    const iapMod = mod as unknown as {
      ExternalPurchaseLink?: ExternalPurchaseLinkModule;
      openExternalPurchaseLink?: (url: string) => Promise<void>;
    };

    if (typeof iapMod.ExternalPurchaseLink?.open === "function") {
      _externalPurchaseLinkModule = iapMod.ExternalPurchaseLink;
      return _externalPurchaseLinkModule;
    }

    if (typeof iapMod.openExternalPurchaseLink === "function") {
      _externalPurchaseLinkModule = {
        open: iapMod.openExternalPurchaseLink,
      };
      return _externalPurchaseLinkModule;
    }

    // フォールバック: Linking.openURL を使用 (Entitlement 申請前)
    _externalPurchaseLinkModule = null;
    return null;
  } catch {
    _externalPurchaseLinkModule = null;
    return null;
  }
}

// =============================================================================
// 外部ブラウザ起動
// =============================================================================

/**
 * redirectUrl を外部ブラウザ (Safari) で開く。
 *
 * Entitlement 取得済み → `StoreKit.ExternalPurchaseLink.open(url)`
 * Entitlement 未取得  → `Linking.openURL(url)` でフォールバック
 *
 * docs/billing-ui-flow.md §8.3 Step 4
 */
export async function openExternalPurchaseUrl(url: string): Promise<Result<void>> {
  const externalPurchaseLink = await getExternalPurchaseLinkModule();

  try {
    if (externalPurchaseLink != null) {
      // Entitlement 取得済み: StoreKit.ExternalPurchaseLink.open を使用
      await externalPurchaseLink.open(url);
    } else {
      // フォールバック: Linking.openURL (Entitlement 申請前 / Stripe Web Checkout 用)
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        return err({
          code: "BILLING_CHANNEL_NOT_AVAILABLE",
          message: `Cannot open URL: ${url}`,
          retryable: false,
        });
      }
      await Linking.openURL(url);
    }
    return { ok: true, data: undefined };
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Failed to open external purchase URL";
    return err({
      code: "BILLING_PAYMENT_FAILED",
      message,
      retryable: true,
    });
  }
}

// =============================================================================
// External Purchase フロー
// docs/billing-ui-flow.md §8.3
// =============================================================================

export interface StartExternalCheckoutOptions {
  /** 購入対象プランの tier */
  targetTier: string;
  /** server から redirectUrl を取得するコールバック */
  fetchRedirectUrl: (targetTier: string) => Promise<Result<{ redirectUrl: string }>>;
  /** Stripe Web Checkout フォールバック用コールバック (Entitlement 未取得時) */
  onFallbackToStripe?: (targetTier: string) => void;
}

export interface StartExternalCheckoutResult {
  redirectUrl: string;
}

/**
 * External Purchase チェックアウトを開始する。
 * docs/billing-ui-flow.md §8.3 Step 3-4
 *
 * 1. 対象国判定
 * 2. server から redirectUrl を取得 (startExternalPurchase)
 * 3. StoreKit.ExternalPurchaseLink.open または Linking.openURL で Safari を起動
 *
 * フォールバック:
 * - 対象国外: Stripe Web Checkout (T-42) に委ねる
 * - Entitlement 未取得: Linking.openURL にフォールバック
 *
 * @returns Result<{ redirectUrl }> — 起動した URL
 */
export async function startExternalCheckout(
  options: StartExternalCheckoutOptions,
): Promise<Result<StartExternalCheckoutResult>> {
  const { targetTier, fetchRedirectUrl, onFallbackToStripe } = options;

  // iOS 以外は External Purchase 不可
  if (Platform.OS !== "ios") {
    return err({
      code: "BILLING_CHANNEL_NOT_AVAILABLE",
      message: "StoreKit External Purchase is iOS only",
      retryable: false,
    });
  }

  // 対象国外: Stripe Web Checkout へフォールバック
  if (!isExternalPurchaseEligible()) {
    onFallbackToStripe?.(targetTier);
    return err({
      code: "BILLING_CHANNEL_NOT_AVAILABLE",
      message: "External Purchase is not available in this region",
      retryable: false,
    });
  }

  // server から redirectUrl を取得
  const redirectResult = await fetchRedirectUrl(targetTier);
  if (!redirectResult.ok) {
    return redirectResult;
  }

  const { redirectUrl } = redirectResult.data;

  // 外部ブラウザを起動
  const openResult = await openExternalPurchaseUrl(redirectUrl);
  if (!openResult.ok) {
    return openResult;
  }

  return {
    ok: true,
    data: { redirectUrl },
  };
}

// =============================================================================
// Deep link パース
// docs/billing-ui-flow.md §4.5 StoreKitExternalRedirectResult
// =============================================================================

/**
 * deep link URL から StoreKitExternalRedirectResult をパースする。
 *
 * 対象 URL: `trancall://billing/external-success?token=xxx`
 * またはその後の拡張: `trancall://billing/external-success?token=xxx&sub=xxx&at=xxx`
 *
 * docs/billing-ui-flow.md §8.3 Step 5-6
 */
export interface ParsedExternalSuccessLink {
  redirectToken: string;
  stripeSubscriptionId: string;
  completedAt: string;
}

/**
 * URL のクエリパラメータをパースする。
 * React Native 環境では DOM URL API が利用できないため、
 * 文字列処理でパースする。
 */
function parseQueryParams(query: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (query === "" || query === "?") return params;

  const qs = query.startsWith("?") ? query.slice(1) : query;
  for (const pair of qs.split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = decodeURIComponent(pair.slice(0, eqIdx));
    const val = decodeURIComponent(pair.slice(eqIdx + 1));
    if (key !== "") {
      params[key] = val;
    }
  }
  return params;
}

export function parseExternalSuccessLink(
  url: string,
): Result<ParsedExternalSuccessLink> {
  // trancall://billing/external-success?token=xxx の形式をパース
  // スキーム: trancall://  ホスト: billing  パス: /external-success
  const schemePrefix = "trancall://billing/external-success";
  const schemePrefixNoQuery = schemePrefix;

  if (
    !url.startsWith(schemePrefixNoQuery + "?") &&
    url !== schemePrefixNoQuery
  ) {
    return err({
      code: "BILLING_PAYMENT_FAILED",
      message: `Unexpected deep link URL: ${url}`,
      retryable: false,
    });
  }

  const queryStart = url.indexOf("?");
  const queryString = queryStart !== -1 ? url.slice(queryStart) : "";
  const params = parseQueryParams(queryString);

  const token = params["token"];
  if (token == null || token === "") {
    return err({
      code: "BILLING_PAYMENT_FAILED",
      message: "Missing token in external-success deep link",
      retryable: false,
    });
  }

  // stripeSubscriptionId は server が redirectToken から解決するため
  // deep link に含まれない場合は空文字で許容 (server 側で token から取得)
  const stripeSubscriptionId = params["sub"] ?? "";

  // completedAt は現在時刻を使用 (deep link に含まれない場合)
  const completedAtParam = params["at"];
  const completedAt =
    completedAtParam != null && completedAtParam !== ""
      ? completedAtParam
      : new Date().toISOString();

  return {
    ok: true,
    data: {
      redirectToken: token,
      stripeSubscriptionId,
      completedAt,
    },
  };
}
