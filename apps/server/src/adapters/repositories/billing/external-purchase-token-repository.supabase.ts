/**
 * ExternalPurchaseTokenRepository — Supabase 実装
 *
 * trancall_billing.external_purchase_tokens テーブルを管理する。
 * docs/billing-ui-flow.md v1.2 §15.3 が canonical。
 * canonical interface: packages/billing/src/repositories/external-purchase-token-repository.ts
 *
 * T-12 で apps/server 内に追加された実装を、T-7 canonical interface に合わせて書き換え。
 * 主に packages/billing 側の createSupabaseExternalPurchaseTokenRepository へ委譲する薄いラッパ。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExternalPurchaseTokenRepository,
  ExternalPurchaseTokenRow,
  PlanTier,
} from "@trancall/billing";
import { createSupabaseExternalPurchaseTokenRepository } from "@trancall/billing";
import type { Result, UserId } from "@trancall/shared-kernel";

export function createExternalPurchaseTokenRepository(
  supabase: SupabaseClient,
): ExternalPurchaseTokenRepository {
  // canonical 実装は packages/billing 側に存在。SupabaseClient を直接渡す。
  return createSupabaseExternalPurchaseTokenRepository(supabase);
}

// Re-export the canonical types for downstream container.ts consumption
export type { ExternalPurchaseTokenRepository, ExternalPurchaseTokenRow, PlanTier };
export type { Result, UserId };
