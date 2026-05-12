/**
 * ExternalPurchaseTokenRepository — StoreKit External Purchase トークン管理
 *
 * docs/billing-ui-flow.md v1.2 §15.3 canonical 設計準拠。
 * redirectToken の TTL 5 分・1 回限り使い捨て制約を管理する。
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

// =============================================================================
// Supabase 実装
// =============================================================================

/**
 * Supabase (service_role) を使った ExternalPurchaseTokenRepository 実装。
 * DB テーブル: trancall_billing.external_purchase_tokens
 *
 * @param supabase supabase-js SupabaseClient (service_role)
 */
export function createSupabaseExternalPurchaseTokenRepository(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapters/* 相当の境界インターフェース
  supabase: any,
): ExternalPurchaseTokenRepository {
  const TABLE = "external_purchase_tokens";
  const SCHEMA = "trancall_billing";

  return {
    async createToken(
      userId: UserId,
      targetTier: PlanTier,
      stripeSessionId: string,
      token: string,
      ttlMinutes: number,
    ): Promise<Result<ExternalPurchaseTokenRow>> {
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- supabase client
      const { data, error } = await supabase
        .schema(SCHEMA)
        .from(TABLE)
        .insert({
          user_id: userId as string,
          token,
          target_tier: targetTier,
          stripe_session_id: stripeSessionId,
          expires_at: expiresAt,
          used: false,
        })
        .select()
        .single();

      if (error !== null) {
        return {
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: `ExternalPurchaseToken 作成失敗: ${String(error.message)}`,
            retryable: true,
          },
        };
      }
      return { ok: true, data: mapRow(data) };
    },

    async findByToken(token: string): Promise<Result<ExternalPurchaseTokenRow>> {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const { data, error } = await supabase
        .schema(SCHEMA)
        .from(TABLE)
        .select("*")
        .eq("token", token)
        .single();

      if (error !== null) {
        return {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: `redirectToken が見つかりません: ${token.slice(0, 8)}...`,
            retryable: false,
          },
        };
      }
      return { ok: true, data: mapRow(data) };
    },

    async markUsed(token: string): Promise<Result<true>> {
      // 二重消費防止: used=false の行のみ更新。影響行数 0 は使用済み or 存在しない。
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const { data, error } = await supabase
        .schema(SCHEMA)
        .from(TABLE)
        .update({ used: true })
        .eq("token", token)
        .eq("used", false)
        .select("id");

      if (error !== null) {
        return {
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: `markUsed 失敗: ${String(error.message)}`,
            retryable: true,
          },
        };
      }

      // data が空配列 → 影響行数 0 → 使用済み or 存在しない
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (!Array.isArray(data) || data.length === 0) {
        return {
          ok: false,
          error: {
            code: "BILLING_PAYMENT_FAILED",
            message:
              "redirectToken は既に使用済みか存在しません。二重消費を防止しました。",
            retryable: false,
          },
        };
      }

      return { ok: true, data: true };
    },

    async cleanupExpired(): Promise<Result<number>> {
      const now = new Date().toISOString();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const { data, error } = await supabase
        .schema(SCHEMA)
        .from(TABLE)
        .delete()
        .lt("expires_at", now)
        .eq("used", false)
        .select("id");

      if (error !== null) {
        return {
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: `cleanupExpired 失敗: ${String(error.message)}`,
            retryable: true,
          },
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const count = Array.isArray(data) ? data.length : 0;
      return { ok: true, data: count };
    },
  };
}

// =============================================================================
// 行マッピングヘルパー
// =============================================================================

function mapRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DB 生行
  row: any,
): ExternalPurchaseTokenRow {
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    id: row.id,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    userId: row.user_id,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    token: row.token,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    targetTier: row.target_tier,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    stripeSessionId: row.stripe_session_id,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    expiresAt: row.expires_at,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    used: row.used,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    createdAt: row.created_at,
  };
}
