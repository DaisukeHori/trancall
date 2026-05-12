/**
 * ExternalPurchaseTokenRepository — Supabase 実装
 *
 * trancall_billing.external_purchase_tokens テーブルを管理する。
 * docs/billing-ui-flow.md v1.2 §15.3 が canonical。
 * TTL: 5 分 / 使用フラグ: used (1 回限り)
 */

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExternalPurchaseTokenRepository } from "@trancall/billing";
import type { ExternalPurchaseTokenRow, PlanTier } from "@trancall/billing";
import { ExternalPurchaseTokenRow as ExternalPurchaseTokenRowSchema } from "@trancall/billing";
import { type Result, type UserId, err, ok } from "@trancall/shared-kernel";

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 分

function mapRow(row: Record<string, unknown>): Result<ExternalPurchaseTokenRow> {
  const parsed = ExternalPurchaseTokenRowSchema.safeParse(row);
  if (!parsed.success) {
    return err({
      code: "INTERNAL_ERROR",
      message: "DB から取得した external_purchase_tokens のスキーマが不正です",
      retryable: false,
      details: { issues: parsed.error.issues.map((i) => i.message) },
    });
  }
  return ok(parsed.data);
}

export function createExternalPurchaseTokenRepository(
  supabase: SupabaseClient,
): ExternalPurchaseTokenRepository {
  return {
    async create(params: {
      userId: UserId;
      targetTier: PlanTier;
      stripeSessionId: string;
    }): Promise<Result<ExternalPurchaseTokenRow>> {
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

      const { data, error } = await supabase
        .schema("trancall_billing")
        .from("external_purchase_tokens")
        .insert({
          user_id: params.userId,
          token,
          target_tier: params.targetTier,
          stripe_session_id: params.stripeSessionId,
          expires_at: expiresAt,
          used: false,
        })
        .select()
        .single();

      if (error) {
        return err({
          code: "INTERNAL_ERROR",
          message: error.message,
          retryable: true,
        });
      }

      return mapRow(data as Record<string, unknown>);
    },

    async findValidByToken(token: string): Promise<Result<ExternalPurchaseTokenRow | null>> {
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .schema("trancall_billing")
        .from("external_purchase_tokens")
        .select("id, user_id, token, target_tier, stripe_session_id, expires_at, used, created_at")
        .eq("token", token)
        .eq("used", false)
        .gt("expires_at", now)
        .maybeSingle();

      if (error) {
        return err({
          code: "INTERNAL_ERROR",
          message: error.message,
          retryable: true,
        });
      }

      if (!data) return ok(null);

      return mapRow(data as Record<string, unknown>);
    },

    async markUsed(id: string): Promise<Result<void>> {
      const { error } = await supabase
        .schema("trancall_billing")
        .from("external_purchase_tokens")
        .update({ used: true })
        .eq("id", id);

      if (error) {
        return err({
          code: "INTERNAL_ERROR",
          message: error.message,
          retryable: true,
        });
      }

      return ok(undefined);
    },
  };
}
