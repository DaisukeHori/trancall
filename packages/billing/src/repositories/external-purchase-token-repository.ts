/**
 * ExternalPurchaseTokenRepository インターフェース
 *
 * external_purchase_tokens テーブルへのアクセス。
 * docs/billing-ui-flow.md v1.2 §15.3 が canonical。
 * TTL: 5 分 / 使用フラグ: used (1 回限り)
 * 実装は apps/server 側 (Supabase)。
 */

import type { Result, UserId } from "@trancall/shared-kernel";
import type { ExternalPurchaseTokenRow, PlanTier } from "../schemas.js";

export interface ExternalPurchaseTokenRepository {
  /**
   * redirectToken を新規発行して INSERT する。
   * token / expiresAt は repository 内で生成する。
   */
  create(params: {
    userId: UserId;
    targetTier: PlanTier;
    stripeSessionId: string;
  }): Promise<Result<ExternalPurchaseTokenRow>>;

  /**
   * token 文字列でレコードを取得する (未使用かつ有効期限内のみ)。
   * 存在しない / 期限切れ / 使用済みの場合は null を返す。
   */
  findValidByToken(token: string): Promise<Result<ExternalPurchaseTokenRow | null>>;

  /**
   * トークンを使用済みにマークする (1 回限り)。
   */
  markUsed(id: string): Promise<Result<void>>;
}
