/**
 * ProfileRepository — Supabase 実装
 *
 * trancall_auth.profiles テーブルから Profile を取得する。
 *
 * Issue #79: `trancall_auth.profiles` に `email` 列は存在しない (canonical な
 * 置き場所は `auth.users` 側)。SELECT には含めず、service_role の
 * `supabase.auth.admin.getUserById()` で `auth.users` から email を取得して
 * Profile に合成する。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ProfileSchema } from "@trancall/auth";
import type { ProfileRepository } from "@trancall/auth";
import { type Result, type UserId, err, ok } from "@trancall/shared-kernel";
import type { Profile } from "@trancall/auth";

export function createProfileRepository(
  supabase: SupabaseClient,
): ProfileRepository {
  return {
    async findByUserId(userId: UserId): Promise<Result<Profile>> {
      const { data, error } = await supabase
        .schema("trancall_auth")
        .from("profiles")
        .select("user_id, display_name, native_language, trancall_id, updated_at")
        .eq("user_id", userId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          return err({
            code: "AUTH_PROFILE_NOT_FOUND",
            message: `プロフィールが見つかりません: ${userId}`,
            retryable: false,
          });
        }
        return err({
          code: "INTERNAL_ERROR",
          message: error.message,
          retryable: true,
        });
      }

      // email は profiles テーブルに存在しないため、auth.users から取得して合成する (Issue #79)。
      const { data: userData, error: userError } =
        await supabase.auth.admin.getUserById(userId);

      if (userError) {
        return err({
          code: "INTERNAL_ERROR",
          message: userError.message,
          retryable: true,
        });
      }

      if (!userData.user.email) {
        return err({
          code: "INTERNAL_ERROR",
          message: `auth.users にメールアドレスが設定されていません: ${userId}`,
          retryable: false,
        });
      }

      const parsed = ProfileSchema.safeParse({
        userId: data["user_id"],
        email: userData.user.email,
        displayName: data["display_name"] ?? undefined,
        nativeLanguage: data["native_language"],
        trancallId: data["trancall_id"],
        updatedAt: data["updated_at"],
      });

      if (!parsed.success) {
        return err({
          code: "INTERNAL_ERROR",
          message: "DB から取得したプロフィールのスキーマが不正です",
          retryable: false,
          details: { issues: parsed.error.issues.map((i) => i.message) },
        });
      }

      return ok(parsed.data);
    },
  };
}
