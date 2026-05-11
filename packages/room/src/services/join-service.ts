/**
 * join-service — joinCall のコアロジック
 *
 * docs/call-lifecycle.md Section 2 に準拠。
 */

import type { Result, AppError, UserId, RoomId } from "@trancall/shared-kernel";

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
  joinCall(roomId: RoomId, userId: UserId): Promise<Result<RoomState, AppError>>;
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

      // 2. participants upsert — UNIQUE(room_id, user_id) に基づいて冪等
      const joinedAt = new Date().toISOString();
      const upsertResult = await participantRepo.upsert({
        roomId,
        userId,
        role: "member",
        joinedAt,
      });
      if (!upsertResult.ok) {
        return upsertResult;
      }

      // 3. status='waiting' → 'active' に遷移 (非 host が join した時)
      let updatedRoomRow = roomRow;
      if (roomRow.status === "waiting") {
        const updateResult = await roomRepo.updateStatus(roomId, "active");
        if (!updateResult.ok) {
          return updateResult;
        }
        updatedRoomRow = updateResult.data;
      }

      // 4. EventBus.publish room.participant_joined
      // userId は UserId (Branded Type) なのでそのまま渡せる
      const event = createParticipantJoinedEvent({
        roomId,
        userId,
        role: "member",
        joinedAt,
      });
      await eventBus.publish(event);

      // 5. RoomState を返す
      const participantsResult = await participantRepo.findByRoomId(roomId);
      if (!participantsResult.ok) {
        return participantsResult;
      }

      return buildRoomState(updatedRoomRow, participantsResult.data);
    },
  };
}
