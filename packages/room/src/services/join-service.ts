/**
 * join-service — joinCall のコアロジック
 *
 * docs/call-lifecycle.md Section 2 に準拠。
 */

import type { Result, UserId, RoomId } from "@trancall/shared-kernel";

import type { RoomState } from "../schemas.js";
import type { RoomRepository } from "../repositories/room-repository.js";
import type { ParticipantRepository } from "../repositories/participant-repository.js";
import type { EventBus } from "../event-bus.js";
import { createParticipantJoinedEvent } from "../events/participant-joined.js";
import { buildRoomState } from "./state-builder.js";

export interface JoinServiceDeps {
  roomRepo: RoomRepository;
  participantRepo: ParticipantRepository;
  eventBus: EventBus;
}

export interface JoinService {
  joinCall(roomId: RoomId, userId: UserId): Promise<Result<RoomState>>;
}

export function createJoinService(deps: JoinServiceDeps): JoinService {
  const { roomRepo, participantRepo, eventBus } = deps;

  return {
    async joinCall(roomId, userId) {
      // 1. rooms.findById → 存在しない or ended なら error
      const roomResult = await roomRepo.findById(roomId);
      if (!roomResult.ok) {
        return roomResult;
      }

      const roomRow = roomResult.data;

      if (roomRow.status === "ended") {
        return {
          ok: false,
          error: {
            code: "ROOM_ALREADY_ENDED",
            message: `Room ${roomId} は既に終了しています`,
            retryable: false,
          },
        };
      }

      // 2. 確定#2 (認可バイパス修正): 招待されていない第三者の自己エンロールを防ぐ。
      // createCall が host + invitee を participants に事前登録している
      // (invitee は joined_at: null の「招待済み・未参加」状態) ため、
      // 既存の participant 行を持たないユーザーは「招待されていない」とみなし拒否する。
      const existingResult = await participantRepo.findOne(roomId, userId);
      if (!existingResult.ok) {
        return existingResult;
      }
      if (existingResult.data === null) {
        return {
          ok: false,
          error: {
            code: "ROOM_USER_NOT_INVITED",
            message: `ユーザー ${userId} はこの通話に招待されていません`,
            retryable: false,
          },
        };
      }

      // 3. joined_at のみ更新する (markJoined は role を書き換えない —
      // host が自分自身で再 join しても role が member に降格しないようにするため、
      // upsert (全列書き換え) ではなくこちらを使う)。
      const joinedAt = new Date().toISOString();
      const markResult = await participantRepo.markJoined(roomId, userId, joinedAt);
      if (!markResult.ok) {
        return markResult;
      }
      const participantRow = markResult.data;

      // 4. status='waiting' → 'active' に遷移 (非 host が join した時)
      let updatedRoomRow = roomRow;
      if (roomRow.status === "waiting") {
        const updateResult = await roomRepo.updateStatus(roomId, "active");
        if (!updateResult.ok) {
          return updateResult;
        }
        updatedRoomRow = updateResult.data;
      }

      // 5. EventBus.publish room.participant_joined
      // userId は UserId (Branded Type) なのでそのまま渡せる。role は既存行の実際の role
      // (host が再 join した場合も "host" のまま、旧実装のような固定 "member" にしない)。
      const event = createParticipantJoinedEvent({
        roomId,
        userId,
        role: participantRow.role,
        joinedAt,
      });
      await eventBus.publish(event);

      // 6. RoomState を返す
      const participantsResult = await participantRepo.findByRoomId(roomId);
      if (!participantsResult.ok) {
        return participantsResult;
      }

      return buildRoomState(updatedRoomRow, participantsResult.data);
    },
  };
}
