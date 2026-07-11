/**
 * ProfileWriteRepository — Supabase 実装 (Issue #72.1)
 *
 * trancall_auth.profiles への書き込みを担う。
 * これまで apps/server/src/routes/auth-routes.ts (PATCH /api/auth/profile) が
 * `supabase.schema("trancall_auth").from("profiles")` を直接呼んでいた (facade バイパス)
 * ものを、この repository + AuthFacade.updateProfile 経由に置き換える。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileWriteRepository, ProfileUpdateFields } from "@trancall/auth";
import { type Result, type UserId, err, ok } from "@trancall/shared-kernel";

export function createProfileWriteRepository(
  supabase: SupabaseClient,
): ProfileWriteRepository {
  return {
    async update(userId: UserId, updates: ProfileUpdateFields): Promise<Result<void>> {
      const row: Record<string, string> = {};
      if (updates.displayName !== undefined) row["display_name"] = updates.displayName;
      if (updates.nativeLanguage !== undefined) row["native_language"] = updates.nativeLanguage;
      if (updates.avatarUrl !== undefined) row["avatar_url"] = updates.avatarUrl;

      const { error } = await supabase
        .schema("trancall_auth")
        .from("profiles")
        .update(row)
        .eq("user_id", userId);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(undefined);
    },
  };
}
