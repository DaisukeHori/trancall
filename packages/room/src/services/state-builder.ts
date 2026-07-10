/**
 * state-builder — RoomRow + ParticipantRow[] → RoomState 変換
 *
 * Zod の safeParse を使用して型安全に変換する。
 */

import type { Result, UserId } from "@trancall/shared-kernel";
import {
  RoomIdSchema, UserIdSchema, ParticipantIdSchema,
} from "@trancall/shared-kernel";
import type { RoomRow, ParticipantRow, RoomState } from "../schemas.ts";

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

  // nullable 追従 (00019 migration): created_by は退会済みユーザーの物理削除後に
  // NULL 化されうる。NULL は「退会済みユーザー参照」を意味し、パースエラーにはしない。
  let createdBy: UserId | null = null;
  if (room.created_by !== null) {
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
    createdBy = createdByResult.data;
  }

  const participantResults: RoomState["participants"] = [];
  for (const p of participants) {
    // 確定#2: joined_at === null は「招待済みだがまだ join していない」参加者を表す。
    // 公開 RoomState.participants には実際に join したユーザーのみを含める
    // (未 join の invitee をここに含めると、参加者一覧をベースにした認可チェック
    // (apps/server の isRoomParticipant) が「招待されただけで join していない
    // ユーザー」まで許可してしまい、確定#2 で塞いだはずの穴が再発する)。
    const joinedAt = p.joined_at;
    if (joinedAt === null) continue;

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

    // nullable 追従 (00019 migration): user_id は退会済みユーザーの物理削除後に
    // NULL 化されうる。行自体 (参加履歴) は保持されるため、NULL は
    // 「退会済みユーザー参照」を意味し、パースエラーにはしない。
    let userId: UserId | null = null;
    if (p.user_id !== null) {
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
      userId = uidResult.data;
    }

    participantResults.push({
      id: pidResult.data,
      userId,
      role: p.role,
      isMuted: p.is_muted,
      joinedAt,
      leftAt: p.left_at,
    });
  }

  return {
    ok: true,
    data: {
      roomId: roomIdResult.data,
      status: room.status,
      translationEnabled: room.translation_enabled,
      createdBy,
      createdAt: room.created_at,
      endedAt: room.ended_at,
      participants: participantResults,
    },
  };
}
