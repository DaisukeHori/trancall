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
  // nullable 追従 (00019 migration): 退会し物理削除されると NULL 化される
  user_id: string | null;
  role: ParticipantRole;
  is_muted: boolean;
  // 確定#2: NULL は「招待済みだがまだ join していない」ことを表す
  joined_at: string | null;
  left_at: string | null;
};

type UpsertParticipantCommand = {
  roomId: RoomId;
  userId: UserId;
  role: ParticipantRole;
  // 確定#2: createCall の invitee 事前登録では null (未 join) を渡す
  joinedAt: string | null;
};

const ParticipantRowSchema = z.object({
  id: z.uuid(),
  room_id: z.uuid(),
  // nullable 追従 (00019 migration): 退会し物理削除されると NULL 化される
  user_id: z.uuid().nullable(),
  role: z.enum(["host", "member"]),
  is_muted: z.boolean(),
  // 確定#2: NULL は「招待済みだがまだ join していない」ことを表す
  joined_at: z.iso.datetime().nullable(),
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

    // 確定#2: room_id + user_id に一致する参加者行を 1 件取得する (存在しなければ null)。
    async findOne(roomId: RoomId, userId: UserId): Promise<Result<ParticipantRow | null>> {
      const { data, error } = await supabase
        .schema("trancall_room")
        .from("participants")
        .select("*")
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      if (!data) return ok(null);
      return parseRow(data as Record<string, unknown>);
    },

    // 確定#2: 既存行の joined_at のみを更新する (role は書き換えない)。
    async markJoined(roomId: RoomId, userId: UserId, joinedAt: string): Promise<Result<ParticipantRow>> {
      const { data, error } = await supabase
        .schema("trancall_room")
        .from("participants")
        .update({ joined_at: joinedAt })
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .select()
        .maybeSingle();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      if (!data) {
        return err({
          code: "ROOM_USER_NOT_INVITED",
          message: `ユーザー ${userId} はこの通話に招待されていません`,
          retryable: false,
        });
      }
      return parseRow(data as Record<string, unknown>);
    },
  };
}
