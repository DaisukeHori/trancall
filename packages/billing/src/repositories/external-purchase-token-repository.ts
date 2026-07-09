/**
 * ExternalPurchaseTokenRepository — StoreKit External Purchase トークン管理
 *
 * docs/billing-ui-flow.md v1.2 §15.3 canonical 設計準拠。
 * redirectToken の TTL 5 分・1 回限り使い捨て制約を管理する。
 *
 * 実装は apps/server 側（Supabase）。
 * packages/billing は interface のみ保持し、DI で受け取る
 * (他の billing repository interface と同じ方針)。
 *
 * 二重消費防止パターン:
 *   UPDATE ... SET used=true WHERE token=$1 AND used=false
 *   影響行数 0 → 使用済み or 存在しない → BILLING_PAYMENT_FAILED
 */

import type { Result } from "@trancall/shared-kernel";
import type { UserId } from "@trancall/shared-kernel";
import type { PlanTier } from "../schemas.js";

// =============================================================================
// トークン行型
// =============================================================================

export interface ExternalPurchaseTokenRow {
  id: string;
  userId: string;
  token: string;
  targetTier: PlanTier;
  stripeSessionId: string;
  expiresAt: string; // ISO datetime
  used: boolean;
  createdAt: string; // ISO datetime
}

// =============================================================================
// インターフェース
// =============================================================================

export interface ExternalPurchaseTokenRepository {
  /**
   * 新規トークンを作成する。
   * token は呼び出し元 (BillingFacade / ExternalPurchaseAdapter) が生成して渡す。
   * @param userId 購入ユーザー ID
   * @param targetTier 購入目標プラン
   * @param stripeSessionId Stripe Checkout Session ID
   * @param token crypto.randomBytes(32).toString("hex") で生成した 64 文字トークン
   * @param ttlMinutes TTL (分)。設計上は 5 分固定。
   */
  createToken(
    userId: UserId,
    targetTier: PlanTier,
    stripeSessionId: string,
    token: string,
    ttlMinutes: number,
  ): Promise<Result<ExternalPurchaseTokenRow>>;

  /**
   * トークン文字列でレコードを取得する。
   * 存在しない場合は NOT_FOUND エラー。
   */
  findByToken(token: string): Promise<Result<ExternalPurchaseTokenRow>>;

  /**
   * トークンを使用済みにマークする (二重消費防止)。
   * UPDATE ... SET used=true WHERE token=$1 AND used=false で実装し、
   * 影響行数が 0 の場合は BILLING_PAYMENT_FAILED を返す。
   * TTL 切れのチェックも呼び出し元で行うことを前提とし、
   * このメソッドは「原子的に used フラグを立てる」責務のみ持つ。
   */
  markUsed(token: string): Promise<Result<true>>;

  /**
   * 期限切れかつ未使用のトークンを削除する (クリーンアップジョブ用)。
   * @returns 削除件数
   */
  cleanupExpired(): Promise<Result<number>>;
}
