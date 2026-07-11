/**
 * RoomHistoryEnrichmentRepository (room) — Supabase 実装
 *
 * L-13 (GET /api/rooms/history) が必要とする、room モジュール外が所有するデータへの
 * read-only アクセスをまとめて満たす。room は auth/billing/transcript を直接
 * import できない (docs/module-contracts.md §6 依存方向マトリクス) ため、apps/server
 * (Layer 3) がここで実装して room 側の read-only インターフェースに合わせる。
 *
 * - getProfile: `@trancall/contact` の `profile-search-repository.supabase.ts` と同様、
 *   auth 所有の `trancall_auth.public_profiles` VIEW (migration 00017) を直接読む
 *   (deleted_at IS NULL の行のみ・公開可能な最小カラムのみを返す既存パターンを踏襲)。
 * - getCostYen: billing 所有の `trancall_billing.usage_windows` の amount_yen を
 *   room_id + user_id で SUM する read-only 集計。書き込み・ドメインロジックには
 *   一切関与しない (billing の書き込み経路は `UsageRepository.insertWindowIdempotent`
 *   のまま変更なし)。
 * - hasTranscript: transcript モジュールが既に提供している `AccessRepository.canView`
 *   実装をそのまま再利用する (apps/server の DI コンテナで生成済みのインスタンスを注入、
 *   新規のテーブル直読みを増やさない)。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RoomHistoryEnrichmentRepository,
  RoomHistoryParticipantProfile,
} from "@trancall/room";
import type { AccessRepository } from "@trancall/transcript";
import { type Result, type RoomId, type UserId, err, ok } from "@trancall/shared-kernel";

export function createRoomHistoryEnrichmentRepository(
  supabase: SupabaseClient,
  transcriptAccessRepo: AccessRepository,
): RoomHistoryEnrichmentRepository {
  return {
    async getProfile(
      userId: UserId,
    ): Promise<Result<RoomHistoryParticipantProfile | null>> {
      const { data, error } = await supabase
        .schema("trancall_auth")
        .from("public_profiles")
        .select("display_name, trancall_id, avatar_url")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      if (!data) {
        return ok(null);
      }
      const row = data as Record<string, unknown>;
      const displayName = typeof row["display_name"] === "string" ? row["display_name"] : "";
      const trancallId = typeof row["trancall_id"] === "string" ? row["trancall_id"] : "@unknown";
      const avatarUrl = typeof row["avatar_url"] === "string" ? row["avatar_url"] : null;
      return ok({ displayName, trancallId, avatarUrl });
    },

    async getCostYen(roomId: RoomId, userId: UserId): Promise<Result<number>> {
      const { data, error } = await supabase
        .schema("trancall_billing")
        .from("usage_windows")
        .select("amount_yen")
        .eq("room_id", roomId)
        .eq("user_id", userId);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      const total = (data as Array<{ amount_yen: number }>).reduce(
        (sum, row) => sum + (row.amount_yen ?? 0),
        0,
      );
      return ok(total);
    },

    async hasTranscript(roomId: RoomId, userId: UserId): Promise<Result<boolean>> {
      return transcriptAccessRepo.canView(roomId, userId);
    },
  };
}
