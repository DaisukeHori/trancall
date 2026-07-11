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

import type { RoomState, RoomHistoryResponse, GetRoomHistoryQuery } from "./schemas.ts";
import type { RoomRepository } from "./repositories/room-repository.ts";
import type { ParticipantRepository } from "./repositories/participant-repository.ts";
import type { BlockListRepository } from "./repositories/block-list-repository.ts";
import type { RoomHistoryEnrichmentRepository } from "./repositories/room-history-enrichment-repository.ts";
import type { EventBus } from "./event-bus.ts";
import { createCallLifecycleService, type CreateCallOptions } from "./services/call-lifecycle-service.ts";
import { createJoinService } from "./services/join-service.ts";
import { buildRoomState } from "./services/state-builder.ts";
import { createHistoryService } from "./services/history-service.ts";

export type { CreateCallOptions } from "./services/call-lifecycle-service.ts";

// =============================================================================
// L-13: 通話履歴型 (docs/api-spec.md GET /api/rooms/history) — schemas.ts が正
// =============================================================================

export type {
  RoomHistoryParticipant,
  RoomHistoryEntry,
  RoomHistoryResponse,
  GetRoomHistoryQuery,
} from "./schemas.ts";

// =============================================================================
// インターフェース
// =============================================================================

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
   * 通話履歴を取得する (docs/api-spec.md §GET /api/rooms/history、L-13 で実装完了)
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
  /**
   * Issue #69: ROOM_USER_BLOCKED 判定に使う read-only ビュー。
   * @trancall/contact 所有の block_list への実体は apps/server が注入する。
   */
  blockListRepo: BlockListRepository;
  /**
   * L-13: getRoomHistory の参加者プロフィール/課金額/文字起こし有無の補足情報。
   * 未注入時はフォールバック値を使う (packages/room/src/services/history-service.ts 参照)。
   */
  historyEnrichmentRepo?: RoomHistoryEnrichmentRepository;
}

// =============================================================================
// Factory
// =============================================================================

export function createRoomFacade(deps: RoomFacadeDeps): RoomFacade {
  const {
    roomRepo,
    participantRepo,
    billing,
    media,
    notification,
    eventBus,
    blockListRepo,
    historyEnrichmentRepo,
  } = deps;

  const lifecycleService = createCallLifecycleService({
    roomRepo,
    participantRepo,
    billing,
    media,
    notification,
    eventBus,
    blockListRepo,
  });

  const joinService = createJoinService({
    roomRepo,
    participantRepo,
    eventBus,
    blockListRepo,
  });

  const historyService = createHistoryService({
    roomRepo,
    participantRepo,
    billing,
    // exactOptionalPropertyTypes: true のため、undefined を明示的に渡さず条件付きで spread する
    ...(historyEnrichmentRepo ? { historyEnrichmentRepo } : {}),
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
    // getRoomHistory — L-13
    // docs/api-spec.md GET /api/rooms/history
    // =========================================================================
    async getRoomHistory(
      userId: UserId,
      query: GetRoomHistoryQuery,
    ): Promise<Result<RoomHistoryResponse>> {
      return historyService.getRoomHistory(userId, query);
    },
  };
}
