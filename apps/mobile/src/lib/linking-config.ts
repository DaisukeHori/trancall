/**
 * Deep link / URL scheme ハンドラー登録 (Linking イベントリスナー管理)
 *
 * スキーム: trancall://
 *
 * 登録済み deep link:
 *   - trancall://billing/stripe-success?session_id=xxx  — Stripe Web Checkout 完了
 *   - trancall://billing/stripe-cancel                  — Stripe Web Checkout キャンセル
 *   - trancall://billing/external-success?token=xxx     — StoreKit External Purchase 完了
 *     (docs/billing-ui-flow.md §8.3 Step 5)
 *
 * NOTE: T-42 で `billing/stripe-deep-link.ts` が同等のパース処理を提供する場合、
 * 本ファイルの `handleDeepLink` を deprecated にして `handleStripeDeepLink` に委譲すること。
 */

import { Linking } from "react-native";
import {
  parseExternalSuccessLink,
  type ParsedExternalSuccessLink,
} from "./billing/external-purchase.js";

// =============================================================================
// Deep link パスの定数
// =============================================================================

export const DEEP_LINK_SCHEME = "trancall";

// =============================================================================
// Deep link ハンドラー型定義
// =============================================================================

export interface DeepLinkHandlers {
  /** Stripe Web Checkout 完了 (session_id を受け取る) */
  onStripeSuccess?: (sessionId: string) => void;
  /** Stripe Web Checkout キャンセル */
  onStripeCancel?: () => void;
  /**
   * StoreKit External Purchase 完了
   * deep link: trancall://billing/external-success?token=xxx
   * docs/billing-ui-flow.md §8.3 Step 5-6
   */
  onExternalSuccess?: (payload: ParsedExternalSuccessLink) => void;
}

// =============================================================================
// クエリパラメータパーサー
// React Native 環境では DOM URL API が利用できないため文字列処理を使う
// =============================================================================

function getQueryParam(url: string, key: string): string | null {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return null;
  const qs = url.slice(queryStart + 1);
  for (const pair of qs.split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const k = decodeURIComponent(pair.slice(0, eqIdx));
    if (k === key) {
      return decodeURIComponent(pair.slice(eqIdx + 1));
    }
  }
  return null;
}

// =============================================================================
// URL パーサー / ディスパッチャー
// =============================================================================

/**
 * deep link URL をパースしてハンドラーを呼び出す。
 *
 * @param url - trancall:// スキームの URL
 * @param handlers - 各 deep link に対応するハンドラー
 */
export function handleDeepLink(
  url: string,
  handlers: DeepLinkHandlers,
): void {
  // スキーム確認: trancall://
  if (!url.startsWith(`${DEEP_LINK_SCHEME}://`)) {
    return;
  }

  const withoutScheme = url.slice(`${DEEP_LINK_SCHEME}://`.length);
  const queryStart = withoutScheme.indexOf("?");
  const pathPart =
    queryStart !== -1 ? withoutScheme.slice(0, queryStart) : withoutScheme;

  // trancall://billing/stripe-success?session_id=xxx
  if (pathPart === "billing/stripe-success") {
    const sessionId = getQueryParam(url, "session_id") ?? "";
    handlers.onStripeSuccess?.(sessionId);
    return;
  }

  // trancall://billing/stripe-cancel
  if (pathPart === "billing/stripe-cancel") {
    handlers.onStripeCancel?.();
    return;
  }

  // trancall://billing/external-success?token=xxx
  if (pathPart === "billing/external-success") {
    const parseResult = parseExternalSuccessLink(url);
    if (parseResult.ok) {
      handlers.onExternalSuccess?.(parseResult.data);
    }
    // パースエラーは呼び出し元の refreshSubscription() に任せる
    return;
  }

  // 未知のパス: 無視
}

// =============================================================================
// Linking イベントリスナー登録
// =============================================================================

/**
 * Linking イベントリスナーを登録し、deep link を監視する。
 *
 * - アプリ起動中に受信した URL を処理する (`url` イベント)
 * - アプリが deep link から起動した初期 URL も処理する
 * - 登録解除用の cleanup 関数を返す
 *
 * 使用例 (RootNavigator 等):
 * ```ts
 * useEffect(() => {
 *   const cleanup = registerDeepLinkHandler({
 *     onExternalSuccess: (payload) => {
 *       void billingStore.onExternalPurchaseSuccess(payload);
 *     },
 *     onStripeSuccess: (sessionId) => {
 *       void billingStore.onStripeSuccess(sessionId);
 *     },
 *     onStripeCancel: () => {
 *       billingStore.clearError();
 *     },
 *   });
 *   return cleanup;
 * }, []);
 * ```
 *
 * @param handlers - deep link ハンドラー
 * @returns cleanup 関数 (Linking イベントリスナー解除)
 */
export function registerDeepLinkHandler(
  handlers: DeepLinkHandlers,
): () => void {
  const subscription = Linking.addEventListener(
    "url",
    (event: { url: string }) => {
      handleDeepLink(event.url, handlers);
    },
  );

  // アプリが deep link から起動した場合の初期 URL を処理
  void Linking.getInitialURL().then((initialUrl: string | null) => {
    if (initialUrl != null) {
      handleDeepLink(initialUrl, handlers);
    }
  });

  return () => {
    subscription.remove();
  };
}
