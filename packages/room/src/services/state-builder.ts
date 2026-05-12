/**
 * state-builder — RoomRow + ParticipantRow[] → RoomState 変換
 *
 * Zod の safeParse を使用して型安全に変換する。
 */

import type { Result } from "@trancall/shared-kernel";
import {
  RoomIdSchema, UserIdSchema, ParticipantIdSchema,
} from "@trancall/shared-kernel";
import type { RoomRow, ParticipantRow, RoomState } from "../schemas.js";

/**
 * DB 行から RoomState を組み立てる。
 * Branded Type の変換は SafeParse 経由で行う。
 */
export function buildRoomState(
  room: RoomRow,
  participants: ParticipantRow[],
): Result<RoomState> {
  const roomIdResult = RoomIdSchema.safeParse(room.room_id);
  if (!roomIdResult.success) {
    return {
      ok: false,
      error: {
        code: "ROOM_CREATE_FAILED",
        message: `DB の room_id が UUID 形式ではありません: ${room.room_id}`,
        retryable: false,
      },
    };
  }

  const createdByResult = UserIdSchema.safeParse(room.created_by);
  if (!createdByResult.success) {
    return {
      ok: false,
      error: {
        code: "ROOM_CREATE_FAILED",
        message: `DB の created_by が UUID 形式ではありません: ${room.created_by}`,
        retryable: false,
      },
    };
  }

  const participantResults: RoomState["participants"] = [];
  for (const p of participants) {
    const pidResult = ParticipantIdSchema.safeParse(p.id);
    if (!pidResult.success) {
      return {
        ok: false,
        error: {
          code: "ROOM_CREATE_FAILED",
          message: `DB の participant.id が UUID 形式ではありません: ${p.id}`,
          retryable: false,
        },
      };
    }
    const uidResult = UserIdSchema.safeParse(p.user_id);
    if (!uidResult.success) {
      return {
        ok: false,
        error: {
          code: "ROOM_CREATE_FAILED",
          message: `DB の participant.user_id が UUID 形式ではありません: ${p.user_id}`,
          retryable: false,
        },
      };
    }
    participantResults.push({
      id: pidResult.data,
      userId: uidResult.data,
      role: p.role,
      isMuted: p.is_muted,
      joinedAt: p.joined_at,
      leftAt: p.left_at,
    });
  }

  return {
    ok: true,
    data: {
      roomId: roomIdResult.data,
      status: room.status,
      translationEnabled: room.translation_enabled,
      createdBy: createdByResult.data,
      createdAt: room.created_at,
      endedAt: room.ended_at,
      participants: participantResults,
    },
  };
}
