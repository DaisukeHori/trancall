/**
 * @trancall/room — Public API
 *
 * 外部モジュールはこのファイルが export するシンボルのみ利用できる。
 * services / repositories / events への直接 import は禁止。
 */

// Facade（唯一の外部エントリポイント）
export { createRoomFacade } from "./facade.ts";
export type {
  RoomFacade,
  RoomFacadeDeps,
  RoomHistoryEntry,
  RoomHistoryParticipant,
  RoomHistoryResponse,
  GetRoomHistoryQuery,
  CreateCallOptions,
} from "./facade.ts";

// Schemas（モジュール境界の契約）
export {
  RoomStatusSchema,
  ParticipantRoleSchema,
  ParticipantSchema,
  RoomStateSchema,
  RoomHistoryParticipantSchema,
  RoomHistoryEntrySchema,
  RoomHistoryResponseSchema,
  GetRoomHistoryQuerySchema,
} from "./schemas.ts";

export type {
  RoomStatus,
  ParticipantRole,
  Participant,
  RoomState,
} from "./schemas.ts";

// Error codes
export { RoomErrorCode } from "./errors.ts";
export type { RoomErrorCode as RoomErrorCodeType } from "./errors.ts";

// Repository interfaces（apps/server 側での実装用）
export type { RoomRepository, FindEndedRoomsOptions } from "./repositories/room-repository.ts";
export type { ParticipantRepository } from "./repositories/participant-repository.ts";
export type { BlockListRepository } from "./repositories/block-list-repository.ts";
// L-13: getRoomHistory の補足情報 (apps/server 側での実装用)
export type {
  RoomHistoryEnrichmentRepository,
  RoomHistoryParticipantProfile,
} from "./repositories/room-history-enrichment-repository.ts";

// EventBus interface
export type { EventBus, RoomDomainEvent } from "./event-bus.ts";

// Domain Events
export type { RoomCreatedEvent } from "./events/room-created.ts";
export type { ParticipantJoinedEvent } from "./events/participant-joined.ts";
export type { ParticipantLeftEvent } from "./events/participant-left.ts";

// Constants
export { ROOM_MAX_PARTICIPANTS } from "./constants.ts";
