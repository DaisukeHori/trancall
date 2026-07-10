/**
 * Billing API client
 * apps/server REST endpoint を fetch + Zod safeParse でラップ
 *
 * docs/billing-ui-flow.md v1.2 §5.2 canonical エンドポイント定義
 */

import { z } from "zod";
import type { Result } from "@trancall/shared-kernel";
import { apiFetch } from "./client";
import {
  PlanComparisonViewSchema,
  UpgradePreviewSchema,
  IapTransactionResultSchema,
  StoreKitExternalRedirectResultSchema,
  type IapTransactionResult,
  type StoreKitExternalRedirectResult,
} from "@trancall/billing/client";
import { SubscriptionState } from "@trancall/billing/client";

// =============================================================================
// Response Schemas
// =============================================================================

const GetSubscriptionResponseSchema = z.object({
  ok: z.literal(true),
  data: SubscriptionState,
});

const GetPlanComparisonResponseSchema = z.object({
  ok: z.literal(true),
  data: PlanComparisonViewSchema,
});

const UpgradePreviewResponseSchema = z.object({
  ok: z.literal(true),
  data: UpgradePreviewSchema,
});

const IapTransactionResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    subscription: SubscriptionState,
  }),
});

const RestorePurchasesDataSchema = z.object({
  restoredCount: z.number().int().nonnegative(),
  subscription: SubscriptionState.nullable(),
});

const RestorePurchasesResponseSchema = z.object({
  ok: z.literal(true),
  data: RestorePurchasesDataSchema,
});

const StartExternalPurchaseResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    redirectUrl: z.string(),
  }),
});

const CompleteExternalPurchaseResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    subscription: SubscriptionState,
  }),
});

const CancelSubscriptionResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    subscription: SubscriptionState,
  }),
});

// =============================================================================
// Re-export types for store usage
// =============================================================================

export type { IapTransactionResult, StoreKitExternalRedirectResult };
export { IapTransactionResultSchema, StoreKitExternalRedirectResultSchema };

// =============================================================================
// API functions
// =============================================================================

/**
 * GET /api/billing/subscription
 * 現在のサブスクリプション状態を取得する
 */
export async function getSubscription(
  accessToken: string,
): Promise<Result<z.infer<typeof SubscriptionState>>> {
  return apiFetch(
    "/api/billing/subscription",
    GetSubscriptionResponseSchema.transform((r) => r.data),
    { method: "GET", accessToken },
  );
}

/**
 * GET /api/billing/plans
 * プラン比較ビューを取得する
 * docs/billing-ui-flow.md §5.2 — getPlanComparison に対応
 */
export async function getPlanComparison(
  accessToken: string,
): Promise<Result<z.infer<typeof PlanComparisonViewSchema>>> {
  return apiFetch(
    "/api/billing/plans",
    GetPlanComparisonResponseSchema.transform((r) => r.data),
    { method: "GET", accessToken },
  );
}

/**
 * POST /api/billing/upgrade-preview
 * アップグレードの日割り計算プレビューを取得する
 * docs/billing-ui-flow.md §5.2 — previewUpgrade に対応
 */
export async function previewUpgrade(
  targetTier: string,
  accessToken: string,
): Promise<Result<z.infer<typeof UpgradePreviewSchema>>> {
  return apiFetch(
    "/api/billing/upgrade-preview",
    UpgradePreviewResponseSchema.transform((r) => r.data),
    { method: "POST", accessToken, body: { targetTier } },
  );
}

/**
 * POST /api/billing/iap/apple/transaction
 * StoreKit 2 の Transaction を server に送信し、サブスクリプションを更新する
 * docs/billing-ui-flow.md §5.2 — recordIapTransaction に対応
 */
export async function recordIapTransaction(
  transaction: IapTransactionResult,
  accessToken: string,
): Promise<Result<z.infer<typeof SubscriptionState>>> {
  return apiFetch(
    "/api/billing/iap/apple/transaction",
    IapTransactionResponseSchema.transform((r) => r.data.subscription),
    { method: "POST", accessToken, body: transaction },
  );
}

/**
 * POST /api/billing/iap/apple/restore
 * 購入を復元する (iOS App Store ガイドライン必須)
 * docs/billing-ui-flow.md §5.2 — restorePurchases に対応
 */
export async function restorePurchases(
  transactions: IapTransactionResult[],
  accessToken: string,
): Promise<Result<z.infer<typeof RestorePurchasesDataSchema>>> {
  return apiFetch(
    "/api/billing/iap/apple/restore",
    RestorePurchasesResponseSchema.transform((r) => r.data),
    { method: "POST", accessToken, body: { transactions } },
  );
}

/**
 * POST /api/billing/external-purchase/start
 * StoreKit External Purchase 開始
 * docs/billing-ui-flow.md §5.2 — startExternalPurchase に対応
 */
export async function startExternalPurchase(
  targetTier: string,
  accessToken: string,
): Promise<Result<{ redirectUrl: string }>> {
  return apiFetch(
    "/api/billing/external-purchase/start",
    StartExternalPurchaseResponseSchema.transform((r) => r.data),
    { method: "POST", accessToken, body: { targetTier } },
  );
}

/**
 * POST /api/billing/external-purchase/complete
 * StoreKit External Purchase 完了
 * docs/billing-ui-flow.md §5.2 — completeExternalPurchase に対応
 */
export async function completeExternalPurchase(
  redirect: StoreKitExternalRedirectResult,
  accessToken: string,
): Promise<Result<z.infer<typeof SubscriptionState>>> {
  return apiFetch(
    "/api/billing/external-purchase/complete",
    CompleteExternalPurchaseResponseSchema.transform(
      (r) => r.data.subscription,
    ),
    { method: "POST", accessToken, body: redirect },
  );
}

/**
 * DELETE /api/billing/subscription
 * サブスクリプションをキャンセルする
 * docs/billing-ui-flow.md §5.2 — cancelSubscription に対応
 */
export async function cancelSubscription(
  atPeriodEnd: boolean,
  accessToken: string,
): Promise<Result<z.infer<typeof SubscriptionState>>> {
  return apiFetch(
    "/api/billing/subscription",
    CancelSubscriptionResponseSchema.transform((r) => r.data.subscription),
    { method: "DELETE", accessToken, body: { atPeriodEnd } },
  );
}
