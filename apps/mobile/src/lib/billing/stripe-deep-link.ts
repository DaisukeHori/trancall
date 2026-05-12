/**
 * stripe-deep-link.ts — Stripe / External Purchase deep link ハンドラー
 *
 * docs/billing-ui-flow.md v1.2 §6.3 Step 5 / §8.3 Step 5-6 準拠
 * T-42: Stripe Web Checkout UI 結合 (Linking.openURL + deep link callback)
 *
 * deep link スキーム:
 *   trancall://billing/stripe-success?session_id=cs_xxx    → Stripe 決済成功
 *   trancall://billing/stripe-cancel                       → Stripe 決済キャンセル
 *   trancall://billing/external-success?token=xxx          → External Purchase 成功
 */

import { z } from "zod";
import { StoreKitExternalRedirectResultSchema } from "@trancall/billing";

// =============================================================================
// Deep link URL スキーム定数
// =============================================================================

const DEEP_LINK_PREFIX = "trancall://billing/";
const PATH_STRIPE_SUCCESS = "stripe-success";
const PATH_STRIPE_CANCEL = "stripe-cancel";
const PATH_EXTERNAL_SUCCESS = "external-success";

// =============================================================================
// クエリパラメータ スキーマ
// =============================================================================

const StripeSuccessParamsSchema = z.object({
  session_id: z.string().min(1),
});

const ExternalSuccessParamsSchema = z.object({
  token: z.string().min(1),
  stripe_subscription_id: z.string().min(1).optional(),
  completed_at: z.string().optional(),
});

// =============================================================================
// ハンドラーコールバック型
// =============================================================================

export interface StripeDeepLinkHandlers {
  /**
   * Stripe Checkout 決済成功時に呼び出す
   * @param sessionId Stripe Checkout Session ID (cs_xxx)
   */
  onStripeSuccess: (sessionId: string) => Promise<void>;

  /**
   * Stripe Checkout ユーザーキャンセル時に呼び出す
   * エラー表示なしで通常 UI に戻る (docs/billing-ui-flow.md §6.4)
   */
  onStripeCanceled: () => void;

  /**
   * External Purchase (StoreKit External) 決済成功時に呼び出す
   */
  onExternalPurchaseSuccess: (
    redirect: z.infer<typeof StoreKitExternalRedirectResultSchema>,
  ) => Promise<void>;
}

// =============================================================================
// handleStripeDeepLink
// AppLinkHandler が受け取った URL をここで処理する
// docs/billing-ui-flow.md §6.3 Step 5 / §8.3 Step 6
// =============================================================================

/**
 * deep link URL を解析してハンドラーを呼び出す。
 * billing 関連でない URL は静かに無視する。
 *
 * @param url  受信した deep link URL 文字列
 * @param handlers  各パス向けコールバック
 */
export async function handleStripeDeepLink(
  url: string,
  handlers: StripeDeepLinkHandlers,
): Promise<void> {
  if (!url.startsWith(DEEP_LINK_PREFIX)) {
    // billing 関連以外の deep link は無視
    return;
  }

  const rest = url.slice(DEEP_LINK_PREFIX.length);
  const [path, queryString] = rest.split("?") as [string, string | undefined];

  const params = parseQueryString(queryString ?? "");

  if (path === PATH_STRIPE_SUCCESS) {
    const parsed = StripeSuccessParamsSchema.safeParse(params);
    if (!parsed.success) {
      // session_id がない場合は refreshSubscription 相当の再取得で対応
      // 仕様: 楽観的更新禁止 (docs/billing-ui-flow.md §13.4)
      handlers.onStripeCanceled();
      return;
    }
    await handlers.onStripeSuccess(parsed.data.session_id);
    return;
  }

  if (path === PATH_STRIPE_CANCEL) {
    // ユーザーキャンセル: エラー表示なし (docs/billing-ui-flow.md §6.4)
    handlers.onStripeCanceled();
    return;
  }

  if (path === PATH_EXTERNAL_SUCCESS) {
    const parsed = ExternalSuccessParamsSchema.safeParse(params);
    if (!parsed.success) {
      // token が取れない場合はキャンセル扱い
      handlers.onStripeCanceled();
      return;
    }

    const redirect = StoreKitExternalRedirectResultSchema.safeParse({
      redirectToken: parsed.data.token,
      stripeSubscriptionId: parsed.data.stripe_subscription_id ?? "",
      completedAt:
        parsed.data.completed_at ?? new Date().toISOString(),
    });

    if (!redirect.success) {
      handlers.onStripeCanceled();
      return;
    }

    await handlers.onExternalPurchaseSuccess(redirect.data);
    return;
  }

  // 未知のパス: 無視
}

// =============================================================================
// ユーティリティ: querystring パーサー
// (URLSearchParams は React Native 環境で使用可能だが、テスト環境での依存を最小化)
// =============================================================================

function parseQueryString(qs: string): Record<string, string> {
  if (qs.length === 0) return {};
  const result: Record<string, string> = {};
  for (const pair of qs.split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 0) continue;
    const key = decodeURIComponent(pair.slice(0, eqIdx));
    const value = decodeURIComponent(pair.slice(eqIdx + 1));
    result[key] = value;
  }
  return result;
}
