/**
 * ProfileDeletionRepository — Supabase 実装 (Issue #72.1)
 *
 * trancall_auth.profiles.deleted_at の読み書きを担う。
 * apps/server/src/routes/account-routes.ts (POST /api/account/delete /
 * POST /api/account/restore) が直接 supabase を呼んでいた (facade バイパス) ものを
 * この repository + AuthFacade.getProfileDeletionStatus / setProfileDeletedAt
 * 経由に置き換える。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileDeletionRepository, ProfileDeletionStatus } from "@trancall/auth";
import { type Result, type UserId, err, ok } from "@trancall/shared-kernel";
import { z } from "zod";

/** trancall_auth.profiles から取得した行のうち、本 repository が参照する列のみのスキーマ */
const ProfileDeletionRowSchema = z.object({
  deleted_at: z.string().nullable(),
});

export function createProfileDeletionRepository(
  supabase: SupabaseClient,
): ProfileDeletionRepository {
  return {
    async findStatus(userId: UserId): Promise<Result<ProfileDeletionStatus | null>> {
      const { data, error } = await supabase
        .schema("trancall_auth")
        .from("profiles")
        .select("deleted_at")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }

      if (data == null) {
        return ok(null);
      }

      const parsed = ProfileDeletionRowSchema.safeParse(data);
      if (!parsed.success) {
        return err({
          code: "INTERNAL_ERROR",
          message: "profiles 行のスキーマが不正です",
          retryable: false,
          details: { issues: parsed.error.issues.map((i) => i.message) },
        });
      }

      return ok({ deletedAt: parsed.data.deleted_at });
    },

    async setDeletedAt(userId: UserId, deletedAt: string | null): Promise<Result<true>> {
      const { error } = await supabase
        .schema("trancall_auth")
        .from("profiles")
        .update({ deleted_at: deletedAt })
        .eq("user_id", userId);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true as const);
    },
  };
}
