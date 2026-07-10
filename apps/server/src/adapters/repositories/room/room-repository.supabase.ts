/**
 * RoomRepository — Supabase 実装
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoomRepository } from "@trancall/room";
import type { RoomFacade } from "@trancall/room";
import { type Result, type RoomId, type UserId, err, ok } from "@trancall/shared-kernel";

// packages/room/src/schemas.ts と同等のローカル型定義
// RoomRowSchema / InsertRoomCommand は room パッケージから export されていないため
const RoomStatusSchema = z.enum(["waiting", "active", "ended"]);
type RoomStatus = z.infer<typeof RoomStatusSchema>;

type RoomRow = {
  room_id: string;
  status: RoomStatus;
  room_type: "audio" | "video";
  translation_enabled: boolean;
  // nullable 追従 (00019 migration): 作成者が退会し物理削除されると NULL 化される
  created_by: string | null;
  created_at: string;
  ended_at: string | null;
};

type InsertRoomCommand = {
  roomId: RoomId;
  status: RoomStatus;
  roomType?: "audio" | "video";
  translationEnabled: boolean;
  createdBy: UserId;
  createdAt: string;
};

function parseRow(row: Record<string, unknown>): Result<RoomRow> {
  const parsed = z.object({
    room_id: z.uuid(),
    status: RoomStatusSchema,
    room_type: z.enum(["audio", "video"]),
    translation_enabled: z.boolean(),
    // nullable 追従 (00019 migration): 作成者が退会し物理削除されると NULL 化される
    created_by: z.uuid().nullable(),
    created_at: z.iso.datetime(),
    ended_at: z.iso.datetime().nullable(),
  }).safeParse({
    room_id: row["room_id"],
    status: row["status"],
    room_type: row["room_type"],
    translation_enabled: row["translation_enabled"],
    created_by: row["created_by"],
    created_at: row["created_at"],
    ended_at: row["ended_at"] ?? null,
  });
  if (!parsed.success) {
    return err({ code: "INTERNAL_ERROR", message: "rooms スキーマ不正", retryable: false });
  }
  return ok(parsed.data);
}

export function createRoomRepository(supabase: SupabaseClient): RoomRepository {
  return {
    async insert(cmd: InsertRoomCommand): Promise<Result<RoomRow>> {
      const { data, error } = await supabase
        .schema("trancall_room")
        .from("rooms")
        .insert({
          room_id: cmd.roomId,
          status: cmd.status,
          room_type: cmd.roomType ?? "audio",
          translation_enabled: cmd.translationEnabled,
          created_by: cmd.createdBy,
          created_at: cmd.createdAt,
          ended_at: null,
        })
        .select()
        .single();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return parseRow(data as Record<string, unknown>);
    },

    async findById(roomId: RoomId): Promise<Result<RoomRow>> {
      const { data, error } = await supabase
        .schema("trancall_room")
        .from("rooms")
        .select("*")
        .eq("room_id", roomId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          return err({ code: "ROOM_NOT_FOUND", message: `通話が見つかりません: ${roomId}`, retryable: false });
        }
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return parseRow(data as Record<string, unknown>);
    },

    async updateStatus(
      roomId: RoomId,
      status: "active" | "ended",
      endedAt?: string,
    ): Promise<Result<RoomRow>> {
      const update: Record<string, unknown> = { status };
      if (endedAt) update["ended_at"] = endedAt;

      const { data, error } = await supabase
        .schema("trancall_room")
        .from("rooms")
        .update(update)
        .eq("room_id", roomId)
        .select()
        .single();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return parseRow(data as Record<string, unknown>);
    },
  };
}

// Avoid unused import warning
type _RoomFacadeRef = RoomFacade;
