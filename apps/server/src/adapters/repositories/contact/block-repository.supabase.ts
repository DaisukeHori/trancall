/**
 * BlockRepository — Supabase 実装
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BlockRepository } from "@trancall/contact";
import { type Result, type UserId, err, ok } from "@trancall/shared-kernel";
import type { AppError } from "@trancall/shared-kernel";

export function createBlockRepository(supabase: SupabaseClient): BlockRepository {
  return {
    async block(userId: UserId, blockedUserId: UserId, reason?: string): Promise<Result<true, AppError>> {
      const { error } = await supabase
        .schema("trancall_contact")
        .from("block_list")
        .upsert(
          {
            user_id: userId,
            blocked_user_id: blockedUserId,
            reason: reason ?? null,
            blocked_at: new Date().toISOString(),
          },
          { onConflict: "user_id,blocked_user_id" },
        );

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true);
    },

    async unblock(userId: UserId, blockedUserId: UserId): Promise<Result<true, AppError>> {
      const { error } = await supabase
        .schema("trancall_contact")
        .from("block_list")
        .delete()
        .eq("user_id", userId)
        .eq("blocked_user_id", blockedUserId);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true);
    },

    async isBlocked(userId: UserId, targetUserId: UserId): Promise<boolean> {
      const { count } = await supabase
        .schema("trancall_contact")
        .from("block_list")
        .select("user_id", { count: "exact", head: true })
        .or(
          `and(user_id.eq.${userId},blocked_user_id.eq.${targetUserId}),and(user_id.eq.${targetUserId},blocked_user_id.eq.${userId})`,
        );

      return (count ?? 0) > 0;
    },

    async getBlockedUserIds(userId: UserId): Promise<Set<string>> {
      const { data } = await supabase
        .schema("trancall_contact")
        .from("block_list")
        .select("blocked_user_id")
        .eq("user_id", userId);

      const ids = new Set<string>();
      if (!data) return ids;
      for (const row of data as Array<{ blocked_user_id: string }>) {
        ids.add(row["blocked_user_id"]);
      }
      return ids;
    },
  };
}
