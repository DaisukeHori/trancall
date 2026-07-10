/**
 * @trancall/room 公開ファサード
 *
 * docs/module-contracts.md Section 2.8 の RoomFacade インターフェースを実装する。
 * 他モジュールはこのファサード経由でしか room に触れない。
 */

import type { Result, UserId, RoomId } from "@trancall/shared-kernel";
import type { BillingFacade } from "@trancall/billing";
import type { MediaFacade } from "@trancall/media";
import type { NotificationFacade } from "@trancall/notification";

import type { RoomState } from "./schemas.ts";
import type { RoomRepository } from "./repositories/room-repository.ts";
import type { ParticipantRepository } from "./repositories/participant-repository.ts";
import type { EventBus } from "./event-bus.ts";
import { createCallLifecycleService, type CreateCallOptions } from "./services/call-lifecycle-service.ts";
import { createJoinService } from "./services/join-service.ts";
import { buildRoomState } from "./services/state-builder.ts";

export type { CreateCallOptions } from "./services/call-lifecycle-service.ts";

// =============================================================================
// インターフェース
// =============================================================================

// =============================================================================
// Sprint 3 拡張: 通話履歴型 (docs/api-spec.md GET /api/rooms/history)
// =============================================================================

export interface RoomHistoryParticipant {
  userId: string;
  displayName: string;
  trancallId: string;
  avatarUrl: string | null;
  isHost: boolean;
}

export interface RoomHistoryEntry {
  roomId: string;
  status: "ended";
  roomType: "audio" | "video";
  translationEnabled: boolean;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  participants: RoomHistoryParticipant[];
  myRole: "host" | "member";
  costYen: number;
  hasTranscript: boolean;
}

export interface RoomHistoryResponse {
  rooms: RoomHistoryEntry[];
  nextCursor: string | null;
}

export interface GetRoomHistoryQuery {
  limit: number;
  before?: string;
}

export interface RoomFacade {
  createCall(
    creatorId: UserId,
    inviteeIds: UserId[],
    opts: CreateCallOptions,
  ): Promise<Result<RoomState>>;

  joinCall(roomId: RoomId, userId: UserId): Promise<Result<RoomState>>;

  endCall(roomId: RoomId): Promise<Result<RoomState>>;

  getState(roomId: RoomId): Promise<Result<RoomState>>;

  /**
   * 通話履歴を取得する (docs/api-spec.md §GET /api/rooms/history)
   * Phase 1a P1 (Sprint 3) 実装対象
   */
  getRoomHistory(userId: UserId, query: GetRoomHistoryQuery): Promise<Result<RoomHistoryResponse>>;
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

    // =========================================================================
    // getRoomHistory — Sprint 3 スタブ
    // docs/api-spec.md GET /api/rooms/history
    // =========================================================================
    async getRoomHistory(
      _userId: UserId,
      _query: GetRoomHistoryQuery,
    ): Promise<Result<RoomHistoryResponse>> {
      // Sprint 3 後半で RoomRepository.findEndedByParticipantId を追加して実装
      return { ok: true, data: { rooms: [], nextCursor: null } };
    },
  };
}
