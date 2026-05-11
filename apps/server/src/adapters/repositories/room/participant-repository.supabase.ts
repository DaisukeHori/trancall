/**
 * ParticipantRepository — Supabase 実装
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParticipantRepository } from "@trancall/room";
import { type Result, type RoomId, type UserId, err, ok } from "@trancall/shared-kernel";

// packages/room/src/schemas.ts と同等のローカル型定義
// ParticipantRowSchema / UpsertParticipantCommand は room パッケージから export されていないため
type ParticipantRole = "host" | "member";

type ParticipantRow = {
  id: string;
  room_id: string;
  user_id: string;
  role: ParticipantRole;
  is_muted: boolean;
  joined_at: string;
  left_at: string | null;
};

type UpsertParticipantCommand = {
  roomId: RoomId;
  userId: UserId;
  role: ParticipantRole;
  joinedAt: string;
};

const ParticipantRowSchema = z.object({
  id: z.uuid(),
  room_id: z.uuid(),
  user_id: z.uuid(),
  role: z.enum(["host", "member"]),
  is_muted: z.boolean(),
  joined_at: z.iso.datetime(),
  left_at: z.iso.datetime().nullable(),
});

function parseRow(row: Record<string, unknown>): Result<ParticipantRow> {
  const parsed = ParticipantRowSchema.safeParse({
    id: row["id"],
    room_id: row["room_id"],
    user_id: row["user_id"],
    role: row["role"],
    is_muted: row["is_muted"],
    joined_at: row["joined_at"],
    left_at: row["left_at"] ?? null,
  });
  if (!parsed.success) {
    return err({ code: "INTERNAL_ERROR", message: "participants スキーマ不正", retryable: false });
  }
  return ok(parsed.data);
}

export function createParticipantRepository(supabase: SupabaseClient): ParticipantRepository {
  return {
    async upsert(cmd: UpsertParticipantCommand): Promise<Result<ParticipantRow>> {
      const { data, error } = await supabase
        .schema("trancall_room")
        .from("participants")
        .upsert(
          {
            id: randomUUID(),
            room_id: cmd.roomId,
            user_id: cmd.userId,
            role: cmd.role,
            is_muted: false,
            joined_at: cmd.joinedAt,
            left_at: null,
          },
          { onConflict: "room_id,user_id" },
        )
        .select()
        .single();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return parseRow(data as Record<string, unknown>);
    },

    async findByRoomId(roomId: RoomId): Promise<Result<ParticipantRow[]>> {
      const { data, error } = await supabase
        .schema("trancall_room")
        .from("participants")
        .select("*")
        .eq("room_id", roomId);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }

      const rows: ParticipantRow[] = [];
      for (const row of data as Record<string, unknown>[]) {
        const result = parseRow(row);
        if (result.ok) rows.push(result.data);
      }
      return ok(rows);
    },

    async setLeftAtForAll(roomId: RoomId, leftAt: string): Promise<Result<true>> {
      const { error } = await supabase
        .schema("trancall_room")
        .from("participants")
        .update({ left_at: leftAt })
        .eq("room_id", roomId)
        .is("left_at", null);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true);
    },
  };
}
