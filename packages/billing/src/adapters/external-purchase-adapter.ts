/**
 * ExternalPurchaseAdapter — StoreKit External Purchase フロー
 *
 * docs/billing-ui-flow.md v1.2 §8 canonical 設計準拠。
 *
 * 担当:
 * - generateRedirectToken / persistRedirectToken: [#44] redirectToken を Stripe Checkout
 *   Session 作成前に生成し (success_url に埋め込むため)、Session 作成後に DB へ保存する
 *   2 段階構成 (ExternalPurchaseTokenRepository.createToken + deep link URL 生成)
 * - validateAndConsumeRedirectToken: redirectToken 検証 (TTL / 使用済みチェック) + Stripe 経由 subscription 更新
 * - Apple External Purchase Server API への取引報告 (§15.7)
 *
 * adapters/* 内では型アサーション例外許可 (CLAUDE.md)。
 */

import crypto from "crypto";
import type { Result, UserId } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

import type { PlanTier } from "../schemas.ts";
import type { StoreKitExternalRedirectResult } from "../view-models/index.ts";
import type { ExternalPurchaseTokenRepository } from "../repositories/external-purchase-token-repository.ts";

// =============================================================================
// 設定
// =============================================================================

export interface ExternalPurchaseAdapterConfig {
  /**
   * redirectToken の TTL (分)。設計書 §15.3 では 5 分固定。
   */
  redirectTokenTtlMinutes: number;

  /**
   * Stripe Checkout 完了後の deep link base URL
   * 例: "trancall://billing/external-success"
   * success_url = `{externalSuccessUrl}?token={REDIRECT_TOKEN}`
   */
  externalSuccessUrl: string;

  /**
   * Apple External Purchase Server API エンドポイント (Phase 1a: ログのみ)
   * Phase 1b 以降で実際の API 呼び出しに差し替える
   */
  appleExternalPurchaseApiUrl?: string;
}

// =============================================================================
// ファクトリ
// =============================================================================

export function createExternalPurchaseAdapter(
  tokenRepo: ExternalPurchaseTokenRepository,
  config: ExternalPurchaseAdapterConfig,
) {
  return {
    /**
     * [#44] redirectToken を生成する。
     *
     * Stripe Checkout Session の success_url に埋め込む必要があるため、
     * 必ず stripeWebCheckoutAdapter.createCheckoutSession() を呼ぶ **前** に実行すること
     * (Stripe Checkout Session 作成後に success_url へ token を追加で埋め込む方法は
     * 存在しないため、生成の順序が重要)。生成のみを行い DB への保存は行わない
     * (保存には Stripe Checkout Session 作成後に確定する stripeSessionId が必要なため、
     * persistRedirectToken() を別途呼ぶこと)。
     */
    generateRedirectToken(): string {
      // crypto.randomBytes(32).toString("hex") → 64 文字
      return crypto.randomBytes(32).toString("hex");
    },

    /**
     * [#44] generateRedirectToken() で生成済みの redirectToken を DB に保存し、
     * Apple External Purchase Server API へ取引開始を報告する。
     * Stripe Checkout Session 作成 (stripeSessionId 確定) の **後** に呼ぶこと。
     *
     * @param userId ユーザー ID
     * @param targetTier 目標プラン
     * @param stripeCheckoutUrl Stripe Checkout Session URL (StripeWebCheckoutAdapter 生成済み)
     * @param stripeSessionId Stripe Checkout Session ID
     * @param redirectToken generateRedirectToken() で生成済みのトークン
     * @returns redirectUrl — Safari で開く外部 URL (Stripe Checkout URL)
     */
    async persistRedirectToken(
      userId: Parameters<ExternalPurchaseTokenRepository["createToken"]>[0],
      targetTier: PlanTier,
      stripeCheckoutUrl: string,
      stripeSessionId: string,
      redirectToken: string,
    ): Promise<Result<{ redirectUrl: string; redirectToken: string }>> {
      // Step 1: DB にトークンを保存
      const createResult = await tokenRepo.createToken(
        userId,
        targetTier,
        stripeSessionId,
        redirectToken,
        config.redirectTokenTtlMinutes,
      );
      if (!createResult.ok) return createResult;

      // Step 2: Apple External Purchase Server API へ取引開始報告
      // Phase 1a: ログのみ (Phase 1b で実際の API 呼び出しに差し替え)
      reportExternalPurchaseStart({
        userId,
        targetTier,
        stripeSessionId,
        appleApiUrl: config.appleExternalPurchaseApiUrl,
      });

      // Step 3: Stripe Checkout URL をそのまま返す。
      // [#44] redirectToken は既に stripeWebCheckoutAdapter.createCheckoutSession() 呼び出し時に
      // success_url のクエリパラメータとして埋め込み済み (呼び出し順序については
      // generateRedirectToken() の JSDoc 参照)。
      return ok({
        redirectUrl: stripeCheckoutUrl,
        redirectToken,
      });
    },

    /**
     * External Purchase 完了処理。
     * redirectToken の所有者一致 / TTL / 使用済みフラグを検証し、二重消費・
     * 他ユーザーによるなりすまし消費を防止する (#44)。
     *
     * @param callerUserId 呼び出し元 (実際にリクエストしている) ユーザー ID
     * @param redirect deep link からパースした StoreKitExternalRedirectResult
     */
    async validateAndConsumeRedirectToken(
      callerUserId: UserId,
      redirect: StoreKitExternalRedirectResult,
    ): Promise<
      Result<{
        targetTier: PlanTier;
        stripeSessionId: string;
      }>
    > {
      const { redirectToken } = redirect;

      // Step 1: DB からトークンを取得
      const findResult = await tokenRepo.findByToken(redirectToken);
      if (!findResult.ok) {
        return err({
          code: "BILLING_PAYMENT_FAILED",
          message: "redirectToken が見つかりません",
          retryable: false,
        });
      }

      const tokenRow = findResult.data;

      // Step 2: 所有者一致確認 (#44: tokenRow.userId と呼び出し元 userId の一致確認)
      // markUsed の前に検証することで、なりすましリクエストによる正規ユーザーの
      // トークン消尽 (DoS) を防止する。
      if (tokenRow.userId !== callerUserId) {
        return err({
          code: "BILLING_PAYMENT_FAILED",
          message: "redirectToken の所有者が一致しません",
          retryable: false,
        });
      }

      // Step 3: TTL チェック
      if (new Date() > new Date(tokenRow.expiresAt)) {
        return err({
          code: "BILLING_PAYMENT_FAILED",
          message:
            "redirectToken の有効期限が切れています。もう一度お試しください。",
          retryable: false,
        });
      }

      // Step 4: 二重消費防止 (atomic UPDATE WHERE used=false)
      const markResult = await tokenRepo.markUsed(redirectToken);
      if (!markResult.ok) {
        // markUsed が BILLING_PAYMENT_FAILED を返す = 使用済み
        return markResult;
      }

      // Step 5: Apple External Purchase Server API へ取引完了報告
      // Phase 1a: ログのみ
      reportExternalPurchaseComplete({
        stripeSessionId: tokenRow.stripeSessionId,
        stripeSubscriptionId: redirect.stripeSubscriptionId,
        appleApiUrl: config.appleExternalPurchaseApiUrl,
      });

      return ok({
        targetTier: tokenRow.targetTier,
        stripeSessionId: tokenRow.stripeSessionId,
      });
    },
  };
}

export type ExternalPurchaseAdapter = ReturnType<
  typeof createExternalPurchaseAdapter
>;

// =============================================================================
// Apple External Purchase Server API 報告ヘルパー
// Phase 1a: 実際の API 呼び出しは Phase 1b で実装。ここではログのみ。
// =============================================================================

interface ExternalPurchaseStartParams {
  userId: string;
  targetTier: PlanTier;
  stripeSessionId: string;
  appleApiUrl: string | undefined;
}

function reportExternalPurchaseStart(params: ExternalPurchaseStartParams): void {
  // Phase 1a: ログ出力のみ
  // Phase 1b: POST https://api.storekit.itunes.apple.com/externalPurchase/v1/report
  // PII 除外: stripeSessionId はログ出力可、userId は UUID のみ可
  const apiNote = params.appleApiUrl !== undefined ? ` (API: ${params.appleApiUrl})` : " (Phase 1a: log only)";
  console.log(
    `[ExternalPurchase] START report: userId=${params.userId} tier=${params.targetTier}` +
      ` session=${params.stripeSessionId}${apiNote}`,
  );
}

interface ExternalPurchaseCompleteParams {
  stripeSessionId: string;
  stripeSubscriptionId: string;
  appleApiUrl: string | undefined;
}

function reportExternalPurchaseComplete(
  params: ExternalPurchaseCompleteParams,
): void {
  // Phase 1a: ログ出力のみ
  // Phase 1b: POST https://api.storekit.itunes.apple.com/externalPurchase/v1/report (complete)
  const apiNote = params.appleApiUrl !== undefined ? ` (API: ${params.appleApiUrl})` : " (Phase 1a: log only)";
  console.log(
    `[ExternalPurchase] COMPLETE report: session=${params.stripeSessionId}${apiNote}`,
  );
}
