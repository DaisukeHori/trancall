/**
 * LegacyConsentRepository — Supabase 実装 (Issue #72.1)
 *
 * POST /api/auth/consent (レガシー、単数形) が使う書き込み経路。
 * apps/server/src/routes/auth-routes.ts が直接 `supabase.schema("trancall_auth")
 * .from("consent_versions")` を呼んでいた (facade バイパス) ものを、この repository +
 * AuthFacade.recordLegacyConsentVersion 経由に置き換える。
 *
 * 既知の課題 (本 Issue のスコープ外、詳細は packages/auth/src/repositories/
 * legacy-consent-repository.ts の JSDoc 参照): 書き込み対象・カラム構成は
 * 既存コードのまま変更していない。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LegacyConsentRepository } from "@trancall/auth";
import { type Result, type UserId, err, ok } from "@trancall/shared-kernel";

export function createLegacyConsentRepository(
  supabase: SupabaseClient,
): LegacyConsentRepository {
  return {
    async recordConsentVersion(userId: UserId, consentVersion: string): Promise<Result<true>> {
      const { error } = await supabase
        .schema("trancall_auth")
        .from("consent_versions")
        .upsert(
          {
            user_id: userId,
            consent_version: consentVersion,
            consented_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true as const);
    },
  };
}
