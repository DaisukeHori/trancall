/**
 * @trancall/room 公開ファサード
 *
 * docs/module-contracts.md Section 2.8 の RoomFacade インターフェースを実装する。
 * 他モジュールはこのファサード経由でしか room に触れない。
 */

import type { Result, AppError, UserId, RoomId } from "@trancall/shared-kernel";
import type { BillingFacade } from "@trancall/billing";
import type { MediaFacade } from "@trancall/media";
import type { NotificationFacade } from "@trancall/notification";

import type { RoomState } from "./schemas.js";
import type { RoomRepository } from "./repositories/room-repository.js";
import type { ParticipantRepository } from "./repositories/participant-repository.js";
import type { EventBus } from "./event-bus.js";
import { createCallLifecycleService } from "./services/call-lifecycle-service.js";
import { createJoinService } from "./services/join-service.js";
import { buildRoomState } from "./services/state-builder.js";

// =============================================================================
// インターフェース
// =============================================================================

export interface RoomFacade {
  createCall(
    creatorId: UserId,
    inviteeIds: UserId[],
    opts: { translationEnabled: boolean },
  ): Promise<Result<RoomState, AppError>>;

  joinCall(roomId: RoomId, userId: UserId): Promise<Result<RoomState, AppError>>;

  endCall(roomId: RoomId): Promise<Result<RoomState, AppError>>;

  getState(roomId: RoomId): Promise<Result<RoomState, AppError>>;
}

// =============================================================================
// 依存注入
// =============================================================================

export interface RoomFacadeDeps {
  roomRepo: RoomRepository;
  participantRepo: ParticipantRepository;
  billing: BillingFacade;
  media: MediaFacade;
  notification: NotificationFacade;
  eventBus: EventBus;
}

// =============================================================================
// Factory
// =============================================================================

export function createRoomFacade(deps: RoomFacadeDeps): RoomFacade {
  const { roomRepo, participantRepo, billing, media, notification, eventBus } = deps;

  const lifecycleService = createCallLifecycleService({
    roomRepo,
    participantRepo,
    billing,
    media,
    notification,
    eventBus,
  });

  const joinService = createJoinService({
    roomRepo,
    participantRepo,
    eventBus,
  });

  return {
    // =========================================================================
    // createCall
    // =========================================================================
    async createCall(creatorId, inviteeIds, opts) {
      return lifecycleService.createCall(creatorId, inviteeIds, opts);
    },

    // =========================================================================
    // joinCall
    // =========================================================================
    async joinCall(roomId, userId) {
      return joinService.joinCall(roomId, userId);
    },

    // =========================================================================
    // endCall
    // =========================================================================
    async endCall(roomId) {
      return lifecycleService.endCall(roomId);
    },

    // =========================================================================
    // getState
    // =========================================================================
    async getState(roomId) {
      const roomResult = await roomRepo.findById(roomId);
      if (!roomResult.ok) {
        return roomResult;
      }

      const participantsResult = await participantRepo.findByRoomId(roomId);
      if (!participantsResult.ok) {
        return participantsResult;
      }

      return buildRoomState(roomResult.data, participantsResult.data);
    },
  };
}
