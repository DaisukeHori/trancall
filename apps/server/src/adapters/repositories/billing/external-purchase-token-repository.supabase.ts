/**
 * ExternalPurchaseTokenRepository — Supabase 実装
 *
 * trancall_billing.external_purchase_tokens テーブルを管理する。
 * docs/billing-ui-flow.md v1.2 §15.3 が canonical。
 * canonical interface: packages/billing/src/repositories/external-purchase-token-repository.ts
 *
 * 二重消費防止パターン:
 *   UPDATE ... SET used=true WHERE token=$1 AND used=false
 *   影響行数 0 → 使用済み or 存在しない → BILLING_PAYMENT_FAILED
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExternalPurchaseTokenRepository,
  ExternalPurchaseTokenRow,
} from "@trancall/billing";
import { PlanTier } from "@trancall/billing";
import { type Result, err, ok } from "@trancall/shared-kernel";

const TABLE = "external_purchase_tokens";
const SCHEMA = "trancall_billing";

const RawRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  token: z.string(),
  target_tier: PlanTier,
  stripe_session_id: z.string(),
  expires_at: z.string(),
  used: z.boolean(),
  created_at: z.string(),
});

function mapRow(row: unknown): Result<ExternalPurchaseTokenRow> {
  const parsed = RawRowSchema.safeParse(row);
  if (!parsed.success) {
    return err({
      code: "INTERNAL_ERROR",
      message: "DB から取得した ExternalPurchaseToken のスキーマが不正です",
      retryable: false,
    });
  }
  return ok({
    id: parsed.data.id,
    userId: parsed.data.user_id,
    token: parsed.data.token,
    targetTier: parsed.data.target_tier,
    stripeSessionId: parsed.data.stripe_session_id,
    expiresAt: parsed.data.expires_at,
    used: parsed.data.used,
    createdAt: parsed.data.created_at,
  });
}

export function createExternalPurchaseTokenRepository(
  supabase: SupabaseClient,
): ExternalPurchaseTokenRepository {
  return {
    async createToken(userId, targetTier, stripeSessionId, token, ttlMinutes) {
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .schema(SCHEMA)
        .from(TABLE)
        .insert({
          user_id: userId,
          token,
          target_tier: targetTier,
          stripe_session_id: stripeSessionId,
          expires_at: expiresAt,
          used: false,
        })
        .select()
        .single();

      if (error) {
        return err({
          code: "INTERNAL_ERROR",
          message: `ExternalPurchaseToken 作成失敗: ${error.message}`,
          retryable: true,
        });
      }
      return mapRow(data);
    },

    async findByToken(token) {
      const { data, error } = await supabase
        .schema(SCHEMA)
        .from(TABLE)
        .select("*")
        .eq("token", token)
        .single();

      if (error) {
        return err({
          code: "NOT_FOUND",
          message: `redirectToken が見つかりません: ${token.slice(0, 8)}...`,
          retryable: false,
        });
      }
      return mapRow(data);
    },

    async markUsed(token) {
      // 二重消費防止: used=false の行のみ更新。影響行数 0 は使用済み or 存在しない。
      const { data, error } = await supabase
        .schema(SCHEMA)
        .from(TABLE)
        .update({ used: true })
        .eq("token", token)
        .eq("used", false)
        .select("id");

      if (error) {
        return err({
          code: "INTERNAL_ERROR",
          message: `markUsed 失敗: ${error.message}`,
          retryable: true,
        });
      }

      // data が空配列 → 影響行数 0 → 使用済み or 存在しない
      if (!Array.isArray(data) || data.length === 0) {
        return err({
          code: "BILLING_PAYMENT_FAILED",
          message: "redirectToken は既に使用済みか存在しません。二重消費を防止しました。",
          retryable: false,
        });
      }

      return ok(true as const);
    },

    async cleanupExpired() {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .schema(SCHEMA)
        .from(TABLE)
        .delete()
        .lt("expires_at", now)
        .eq("used", false)
        .select("id");

      if (error) {
        return err({
          code: "INTERNAL_ERROR",
          message: `cleanupExpired 失敗: ${error.message}`,
          retryable: true,
        });
      }
      const count = Array.isArray(data) ? data.length : 0;
      return ok(count);
    },
  };
}
