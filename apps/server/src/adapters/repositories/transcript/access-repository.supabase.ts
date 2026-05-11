/**
 * AccessRepository — Supabase 実装
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccessRepository } from "@trancall/transcript";
import { TranscriptAccessSchema } from "@trancall/transcript";
import type { TranscriptAccess } from "@trancall/transcript";
import { type Result, type RoomId, type UserId, err, ok } from "@trancall/shared-kernel";
import type { AppError } from "@trancall/shared-kernel";

function parseRow(row: Record<string, unknown>): Result<TranscriptAccess, AppError> {
  const parsed = TranscriptAccessSchema.safeParse({
    id: row["id"],
    roomId: row["room_id"],
    userId: row["user_id"],
    canView: row["can_view"],
    canExport: row["can_export"],
    deletedAt: row["deleted_at"] ?? null,
    consentVersion: row["consent_version"],
    createdAt: row["created_at"],
  });
  if (!parsed.success) {
    return err({ code: "INTERNAL_ERROR", message: "transcript_access スキーマ不正", retryable: false });
  }
  return ok(parsed.data);
}

export function createAccessRepository(supabase: SupabaseClient): AccessRepository {
  return {
    async canView(roomId: RoomId, userId: UserId): Promise<Result<boolean, AppError>> {
      const { count, error } = await supabase
        .schema("trancall_transcript")
        .from("transcript_access")
        .select("id", { count: "exact", head: true })
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .eq("can_view", true)
        .is("deleted_at", null);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok((count ?? 0) > 0);
    },

    async softDelete(roomId: RoomId, userId: UserId): Promise<Result<true, AppError>> {
      const { error } = await supabase
        .schema("trancall_transcript")
        .from("transcript_access")
        .update({ deleted_at: new Date().toISOString() })
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .is("deleted_at", null);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true);
    },

    async findOne(roomId: RoomId, userId: UserId): Promise<Result<TranscriptAccess, AppError>> {
      const { data, error } = await supabase
        .schema("trancall_transcript")
        .from("transcript_access")
        .select("*")
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      if (!data) {
        return err({ code: "NOT_FOUND", message: "transcript_access が見つかりません", retryable: false });
      }
      return parseRow(data as Record<string, unknown>);
    },
  };
}
