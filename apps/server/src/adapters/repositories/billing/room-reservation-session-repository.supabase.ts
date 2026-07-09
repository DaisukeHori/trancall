/**
 * RoomReservationSessionRepository — Supabase 実装
 *
 * #46 usage metering: roomId ↔ billing 予約 sessionId の対応表 (trancall_billing.
 * room_reservation_sessions) への apps/server 専用アクセス。
 *
 * このリポジトリは packages/billing の一部ではない (packages/billing の
 * ReservationRepository / SubscriptionRepository 等のインターフェースは変更しない方針のため)。
 * apps/server/src/routes/room-routes.ts (予約作成時の書き込み、/leave の reconcile 用の読み取り) と
 * apps/server/src/adapters/usage-metering-subscriber.ts (translation.ended 購読、#46) の両方から
 * 利用される、apps/server 層専用の roomId 解決テーブル。
 * 設計の詳細は supabase/migrations/00020_add_room_reservation_sessions_table.sql のコメント参照。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { type Result, err, ok } from "@trancall/shared-kernel";

const RoomReservationSessionRowSchema = z.object({
  roomId: z.uuid(),
  userId: z.uuid(),
  sessionId: z.uuid(),
  createdAt: z.string(),
});
export type RoomReservationSessionRow = z.infer<typeof RoomReservationSessionRowSchema>;

function parseRow(row: Record<string, unknown>): Result<RoomReservationSessionRow> {
  const parsed = RoomReservationSessionRowSchema.safeParse({
    roomId: row["room_id"],
    userId: row["user_id"],
    sessionId: row["session_id"],
    createdAt: row["created_at"],
  });
  if (!parsed.success) {
    return err({
      code: "INTERNAL_ERROR",
      message: "room_reservation_sessions スキーマ不正",
      retryable: false,
    });
  }
  return ok(parsed.data);
}

export interface RoomReservationSessionRepository {
  /**
   * roomId → (userId, sessionId) の対応付けを保存する (roomId 一意、conflict 時は上書き)。
   */
  save(params: { roomId: string; userId: string; sessionId: string }): Promise<Result<true>>;

  /**
   * roomId から対応付けを取得する。見つからない場合は ok(null)。
   */
  findByRoomId(roomId: string): Promise<Result<RoomReservationSessionRow | null>>;

  /**
   * roomId の対応付けを削除する。現状呼び出し元はなし (leave 時は translation.ended が
   * まだ届いていない可能性があるため削除しない、上記 migration コメント参照)。
   * 将来のクリーンアップ用に用意する。
   */
  deleteByRoomId(roomId: string): Promise<Result<true>>;
}

export function createRoomReservationSessionRepository(
  supabase: SupabaseClient,
): RoomReservationSessionRepository {
  return {
    async save({ roomId, userId, sessionId }): Promise<Result<true>> {
      const { error } = await supabase
        .schema("trancall_billing")
        .from("room_reservation_sessions")
        .upsert(
          { room_id: roomId, user_id: userId, session_id: sessionId },
          { onConflict: "room_id" },
        );

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true);
    },

    async findByRoomId(roomId: string): Promise<Result<RoomReservationSessionRow | null>> {
      const { data, error } = await supabase
        .schema("trancall_billing")
        .from("room_reservation_sessions")
        .select("*")
        .eq("room_id", roomId)
        .maybeSingle();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      if (!data) return ok(null);
      return parseRow(data as Record<string, unknown>);
    },

    async deleteByRoomId(roomId: string): Promise<Result<true>> {
      const { error } = await supabase
        .schema("trancall_billing")
        .from("room_reservation_sessions")
        .delete()
        .eq("room_id", roomId);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true);
    },
  };
}
