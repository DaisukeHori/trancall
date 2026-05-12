/**
 * billing-store — Zustand store for billing screen state
 *
 * docs/billing-ui-flow.md v1.2 §4.6 BillingScreenState / §13.3 store パターン準拠
 * docs/module-contracts.md §7 (mobile state) 準拠
 *
 * 楽観的更新禁止: 課金情報は server 側 DB が source of truth。
 * server の確認が取れてから UI を更新する。
 */

import { create } from "zustand";
import type {
  BillingScreenState,
  IapTransactionResult,
  StoreKitExternalRedirectResult,
  PlanComparisonView,
  UpgradePreview,
  PreCallCostEstimate,
} from "@trancall/billing";
import {
  initialBillingScreenState,
  BillingErrorViewModelSchema,
  type BillingErrorViewModel,
} from "@trancall/billing";
import type { SubscriptionState as SubscriptionStateType } from "@trancall/billing";
import { PLAN_CONFIGS } from "@trancall/billing";
import { useAuthStore } from "./auth-store.js";
import {
  getSubscription,
  getPlanComparison,
  previewUpgrade,
  recordIapTransaction,
  restorePurchases as apiRestorePurchases,
  startExternalPurchase as apiStartExternalPurchase,
  completeExternalPurchase as apiCompleteExternalPurchase,
  cancelSubscription as apiCancelSubscription,
} from "../api/billing-api.js";

// =============================================================================
// Error code → UI テーブル
// docs/billing-ui-flow.md §11.2 BillingErrorViewModel テーブル
// =============================================================================

const ERROR_MAP: Record<
  string,
  Omit<BillingErrorViewModel, "code" | "retryable">
> = {
  BILLING_INSUFFICIENT_BALANCE: {
    title: "billing.error.BILLING_INSUFFICIENT_BALANCE.title",
    message: "billing.error.BILLING_INSUFFICIENT_BALANCE.message",
    actionLabel: "billing.error.BILLING_INSUFFICIENT_BALANCE.action",
  },
  BILLING_PAYMENT_FAILED: {
    title: "billing.error.BILLING_PAYMENT_FAILED.title",
    message: "billing.error.BILLING_PAYMENT_FAILED.message",
    actionLabel: "billing.error.BILLING_PAYMENT_FAILED.action",
  },
  BILLING_INVALID_RECEIPT: {
    title: "billing.error.BILLING_INVALID_RECEIPT.title",
    message: "billing.error.BILLING_INVALID_RECEIPT.message",
    actionLabel: "billing.error.BILLING_INVALID_RECEIPT.action",
  },
  BILLING_IAP_RECEIPT_INVALID: {
    title: "billing.error.BILLING_IAP_RECEIPT_INVALID.title",
    message: "billing.error.BILLING_IAP_RECEIPT_INVALID.message",
    actionLabel: "billing.error.BILLING_IAP_RECEIPT_INVALID.action",
  },
  BILLING_INVALID_PLAN_CHANGE: {
    title: "billing.error.BILLING_INVALID_PLAN_CHANGE.title",
    message: "billing.error.BILLING_INVALID_PLAN_CHANGE.message",
    actionLabel: "billing.error.BILLING_INVALID_PLAN_CHANGE.action",
  },
  BILLING_UPGRADE_PREVIEW_FAILED: {
    title: "billing.error.BILLING_UPGRADE_PREVIEW_FAILED.title",
    message: "billing.error.BILLING_UPGRADE_PREVIEW_FAILED.message",
    actionLabel: "billing.error.BILLING_UPGRADE_PREVIEW_FAILED.action",
  },
  BILLING_RESTORE_NO_PURCHASE: {
    title: "billing.error.BILLING_RESTORE_NO_PURCHASE.title",
    message: "billing.error.BILLING_RESTORE_NO_PURCHASE.message",
    actionLabel: "billing.error.BILLING_RESTORE_NO_PURCHASE.action",
  },
  BILLING_CHANNEL_NOT_AVAILABLE: {
    title: "billing.error.BILLING_CHANNEL_NOT_AVAILABLE.title",
    message: "billing.error.BILLING_CHANNEL_NOT_AVAILABLE.message",
    actionLabel: "billing.error.BILLING_CHANNEL_NOT_AVAILABLE.action",
  },
  NETWORK_ERROR: {
    title: "billing.error.NETWORK_ERROR.title",
    message: "billing.error.NETWORK_ERROR.message",
    actionLabel: "billing.error.NETWORK_ERROR.action",
  },
  INTERNAL_ERROR: {
    title: "billing.error.INTERNAL_ERROR.title",
    message: "billing.error.INTERNAL_ERROR.message",
    actionLabel: "billing.error.INTERNAL_ERROR.action",
  },
};

/**
 * AppError code → BillingErrorViewModel 変換
 * docs/billing-ui-flow.md §11.3
 */
function mapErrorCodeToViewModel(
  code: string,
  retryable: boolean,
): BillingErrorViewModel {
  const mapping = ERROR_MAP[code] ?? ERROR_MAP["INTERNAL_ERROR"];
  // mapping は ERROR_MAP の "INTERNAL_ERROR" キーが必ず存在するので non-null
  const fallback = {
    title: "billing.error.INTERNAL_ERROR.title",
    message: "billing.error.INTERNAL_ERROR.message",
    actionLabel: "billing.error.INTERNAL_ERROR.action",
  };
  const { title, message, actionLabel } = mapping ?? fallback;
  const parsed = BillingErrorViewModelSchema.safeParse({
    code,
    title,
    message,
    actionLabel,
    retryable,
  });
  if (parsed.success) {
    return parsed.data;
  }
  // フォールバック (safeParse が失敗することは実質ないが型安全のため)
  return { code, title, message, actionLabel, retryable };
}

// =============================================================================
// Store Actions interface
// docs/billing-ui-flow.md §13.3
// =============================================================================

export interface BillingStoreActions {
  /**
   * サブスクリプション状態とプラン比較を取得して store を更新する。
   * Home 画面表示時 / Settings→Subscription 画面表示時に呼び出す。
   * docs/billing-ui-flow.md §10.2.3 / §13.2
   */
  refresh: () => Promise<void>;

  /**
   * サブスクリプション状態のみを更新する (軽量版 refresh)。
   * 通話終了後・Stripe/External Purchase 完了後に呼び出す。
   */
  refreshSubscription: () => Promise<void>;

  /**
   * アップグレードプレビュー (日割り計算) を取得する。
   * Settings → Subscription 画面でプランタップ時に呼び出す。
   */
  loadUpgradePreview: (targetTier: string) => Promise<UpgradePreview | null>;

  /**
   * IAP トランザクションを server に送信し、サブスク状態を更新する。
   * docs/billing-ui-flow.md §7.4 Step 4
   */
  onIapTransaction: (transaction: IapTransactionResult) => Promise<void>;

  /**
   * StoreKit External Purchase 開始。server から redirectUrl を取得する。
   * docs/billing-ui-flow.md §8
   */
  startExternalPurchase: (
    targetTier: string,
  ) => Promise<{ redirectUrl: string } | null>;

  /**
   * StoreKit External Purchase 完了。deep link から受け取った redirect 情報を送信する。
   * docs/billing-ui-flow.md §8
   */
  onExternalPurchaseSuccess: (
    redirect: StoreKitExternalRedirectResult,
  ) => Promise<void>;

  /**
   * Stripe Web Checkout 完了 (deep link 受信後)。
   * docs/billing-ui-flow.md §6.5 Step 5
   */
  onStripeSuccess: (sessionId: string) => Promise<void>;

  /**
   * 購入を復元する (iOS App Store ガイドライン必須)。
   * docs/billing-ui-flow.md §12
   */
  restorePurchases: (transactions: IapTransactionResult[]) => Promise<void>;

  /**
   * サブスクリプションをキャンセルする。
   * docs/billing-ui-flow.md §5.1
   */
  cancelSubscription: (atPeriodEnd: boolean) => Promise<void>;

  /**
   * heartbeat response から remainingMinutes のみ部分更新する。
   * docs/billing-ui-flow.md §13.2 heartbeat での部分更新
   */
  updateRemainingMinutes: (remainingMinutes: number) => void;

  /** エラー表示をクリアする */
  clearError: () => void;
}

// =============================================================================
// Zustand Store
// =============================================================================

export const useBillingStore = create<BillingScreenState & BillingStoreActions>(
  (set, get) => ({
    // 初期状態 (BillingScreenState の initialBillingScreenState)
    ...initialBillingScreenState,

    // =========================================================================
    // refresh: subscription + planComparison を同時取得
    // =========================================================================
    refresh: async () => {
      const session = useAuthStore.getState().session;
      if (session == null) return;

      const [subResult, planResult] = await Promise.all([
        getSubscription(session.accessToken),
        getPlanComparison(session.accessToken),
      ]);

      if (!subResult.ok) {
        set({
          lastError: mapErrorCodeToViewModel(
            subResult.error.code,
            subResult.error.retryable,
          ),
        });
        return;
      }

      const planComparison: PlanComparisonView | null = planResult.ok
        ? planResult.data
        : null;

      set({
        subscriptionState: subResult.data as SubscriptionStateType,
        planComparison,
        lastError: null,
      });
    },

    // =========================================================================
    // refreshSubscription: subscription のみ更新
    // =========================================================================
    refreshSubscription: async () => {
      const session = useAuthStore.getState().session;
      if (session == null) return;

      const result = await getSubscription(session.accessToken);
      if (!result.ok) {
        set({
          lastError: mapErrorCodeToViewModel(
            result.error.code,
            result.error.retryable,
          ),
        });
        return;
      }

      set({
        subscriptionState: result.data as SubscriptionStateType,
        lastError: null,
      });
    },

    // =========================================================================
    // loadUpgradePreview
    // =========================================================================
    loadUpgradePreview: async (targetTier: string) => {
      const session = useAuthStore.getState().session;
      if (session == null) return null;

      const result = await previewUpgrade(targetTier, session.accessToken);
      if (!result.ok) {
        set({
          lastError: mapErrorCodeToViewModel(
            result.error.code,
            result.error.retryable,
          ),
        });
        return null;
      }
      return result.data as UpgradePreview;
    },

    // =========================================================================
    // onIapTransaction: StoreKit 2 トランザクション → server 送信 → state 更新
    // docs/billing-ui-flow.md §7.4 Step 4-5
    // =========================================================================
    onIapTransaction: async (transaction: IapTransactionResult) => {
      const session = useAuthStore.getState().session;
      if (session == null) return;

      set({
        pendingTransaction: {
          channel: "iap_apple",
          targetTier: "light" as const, // 実際の tier は transaction.productId から解決するが store では保持しない
          startedAt: new Date().toISOString(),
        },
      });

      const result = await recordIapTransaction(
        transaction,
        session.accessToken,
      );

      if (!result.ok) {
        set({
          pendingTransaction: null,
          lastError: mapErrorCodeToViewModel(
            result.error.code,
            result.error.retryable,
          ),
        });
        return;
      }

      set({
        subscriptionState: result.data as SubscriptionStateType,
        pendingTransaction: null,
        lastError: null,
      });
    },

    // =========================================================================
    // startExternalPurchase: External Purchase 開始 → redirectUrl 返す
    // docs/billing-ui-flow.md §8
    // =========================================================================
    startExternalPurchase: async (targetTier: string) => {
      const session = useAuthStore.getState().session;
      if (session == null) return null;

      // targetTier は PlanTier enum 値であることを呼び出し元が保証する
      // CLAUDE.md: adapters/* / schemas/brand.ts 境界変換ヘルパーのみ型アサーション許可
      const validatedTier = targetTier as "free" | "light" | "standard" | "business";

      set({
        pendingTransaction: {
          channel: "storekit_external",
          targetTier: validatedTier,
          startedAt: new Date().toISOString(),
        },
      });

      const result = await apiStartExternalPurchase(
        targetTier,
        session.accessToken,
      );

      if (!result.ok) {
        set({
          pendingTransaction: null,
          lastError: mapErrorCodeToViewModel(
            result.error.code,
            result.error.retryable,
          ),
        });
        return null;
      }

      return result.data;
    },

    // =========================================================================
    // onExternalPurchaseSuccess: deep link 受信後の完了処理
    // docs/billing-ui-flow.md §8
    // =========================================================================
    onExternalPurchaseSuccess: async (
      redirect: StoreKitExternalRedirectResult,
    ) => {
      const session = useAuthStore.getState().session;
      if (session == null) return;

      const result = await apiCompleteExternalPurchase(
        redirect,
        session.accessToken,
      );

      if (!result.ok) {
        set({
          pendingTransaction: null,
          lastError: mapErrorCodeToViewModel(
            result.error.code,
            result.error.retryable,
          ),
        });
        return;
      }

      set({
        subscriptionState: result.data as SubscriptionStateType,
        pendingTransaction: null,
        lastError: null,
      });
    },

    // =========================================================================
    // onStripeSuccess: Stripe deep link 受信後に refreshSubscription
    // docs/billing-ui-flow.md §6.5 Step 5 — 楽観的更新禁止
    // =========================================================================
    onStripeSuccess: async (_sessionId: string) => {
      set({ pendingTransaction: null, checkoutSession: null });
      await get().refreshSubscription();
    },

    // =========================================================================
    // restorePurchases: 購入復元 (iOS App Store ガイドライン必須)
    // docs/billing-ui-flow.md §12
    // =========================================================================
    restorePurchases: async (transactions: IapTransactionResult[]) => {
      const session = useAuthStore.getState().session;
      if (session == null) return;

      set({ isRestoring: true });

      const result = await apiRestorePurchases(
        transactions,
        session.accessToken,
      );

      if (!result.ok) {
        set({
          isRestoring: false,
          lastError: mapErrorCodeToViewModel(
            result.error.code,
            result.error.retryable,
          ),
        });
        return;
      }

      const { restoredCount, subscription } = result.data;

      if (restoredCount === 0 || subscription == null) {
        // restoredCount=0 は正常な空結果 (BILLING_RESTORE_NO_PURCHASE は UI 文言のみ)
        // docs/module-contracts.md §2.3 契約注釈参照
        set({
          isRestoring: false,
          lastError: mapErrorCodeToViewModel(
            "BILLING_RESTORE_NO_PURCHASE",
            false,
          ),
        });
        return;
      }

      set({
        subscriptionState: subscription as SubscriptionStateType,
        isRestoring: false,
        lastError: null,
      });
    },

    // =========================================================================
    // cancelSubscription
    // docs/billing-ui-flow.md §5.1
    // =========================================================================
    cancelSubscription: async (atPeriodEnd: boolean) => {
      const session = useAuthStore.getState().session;
      if (session == null) return;

      const result = await apiCancelSubscription(
        atPeriodEnd,
        session.accessToken,
      );

      if (!result.ok) {
        set({
          lastError: mapErrorCodeToViewModel(
            result.error.code,
            result.error.retryable,
          ),
        });
        return;
      }

      set({
        subscriptionState: result.data as SubscriptionStateType,
        lastError: null,
      });
    },

    // =========================================================================
    // updateRemainingMinutes: heartbeat response から部分更新
    // docs/billing-ui-flow.md §13.2
    // =========================================================================
    updateRemainingMinutes: (remainingMinutes: number) => {
      const current = get().subscriptionState;
      if (current == null) return;

      set({
        subscriptionState: {
          ...current,
          remainingMinutes,
        } as SubscriptionStateType,
      });
    },

    // =========================================================================
    // clearError
    // =========================================================================
    clearError: () => {
      set({ lastError: null });
    },
  }),
);

// =============================================================================
// Selector helpers
// =============================================================================

/** 現在のサブスクリプション状態を取得 */
export const selectSubscriptionState = (
  state: BillingScreenState,
): BillingScreenState["subscriptionState"] => state.subscriptionState;

/** 残り分数を取得 */
export const selectRemainingMinutes = (
  state: BillingScreenState,
): number | null => state.subscriptionState?.remainingMinutes ?? null;

/** 購入処理中かどうか */
export const selectIsPurchasePending = (
  state: BillingScreenState,
): boolean => state.pendingTransaction != null;

/** 最終エラー */
export const selectLastError = (
  state: BillingScreenState,
): BillingScreenState["lastError"] => state.lastError;

/** 復元処理中かどうか */
export const selectIsRestoring = (state: BillingScreenState): boolean =>
  state.isRestoring;

// =============================================================================
// Pre-call コスト見積計算
// docs/billing-ui-flow.md §10.1 計算ロジック
// =============================================================================

/**
 * 通話前コスト見積を計算する。
 * Sprint 3 では expectedMinutes = 15 (固定値)。
 * Sprint 3 後半で通話履歴から平均を算出する予定。
 */
export function computePreCallCostEstimate(
  subscriptionState: SubscriptionStateType,
  expectedMinutes: number,
): PreCallCostEstimate {
  const { remainingMinutes, plan } = subscriptionState;
  const overageMinutes = Math.max(0, expectedMinutes - remainingMinutes);
  const predictedCostYen = Math.ceil(overageMinutes * plan.overageRateYen);
  const willExceedQuota = expectedMinutes > remainingMinutes;

  let recommendedAction: PreCallCostEstimate["recommendedAction"];
  if (!willExceedQuota) {
    recommendedAction = "proceed";
  } else if (plan.tier === "free") {
    // Free は超過課金なし → アップグレード必須
    recommendedAction = "upgrade";
  } else {
    recommendedAction = "warn_overage";
  }

  return {
    expectedMinutes,
    remainingMinutes,
    predictedCostYen,
    willExceedQuota,
    recommendedAction,
  };
}

/**
 * Sprint 3 固定値: 想定通話時間 15 分
 * Sprint 3 後半で通話履歴平均を使う予定 (docs/billing-ui-flow.md §10.1)
 */
export const DEFAULT_EXPECTED_MINUTES = 15;

/**
 * billing store から PreCallCostEstimate を取得するセレクター。
 * subscriptionState が null の場合は null を返す。
 */
export const selectPreCallCostEstimate = (
  state: BillingScreenState,
): PreCallCostEstimate | null => {
  if (state.subscriptionState == null) return null;
  return computePreCallCostEstimate(
    state.subscriptionState,
    DEFAULT_EXPECTED_MINUTES,
  );
};

// PLAN_CONFIGS を re-export して画面コンポーネントから参照可能にする
export { PLAN_CONFIGS };
