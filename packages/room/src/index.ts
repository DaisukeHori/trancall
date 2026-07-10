/**
 * @trancall/room — Public API
 *
 * 外部モジュールはこのファイルが export するシンボルのみ利用できる。
 * services / repositories / events への直接 import は禁止。
 */

// Facade（唯一の外部エントリポイント）
export { createRoomFacade } from "./facade";
export type {
  RoomFacade,
  RoomFacadeDeps,
  RoomHistoryEntry,
  RoomHistoryParticipant,
  RoomHistoryResponse,
  GetRoomHistoryQuery,
  CreateCallOptions,
} from "./facade";

// Schemas（モジュール境界の契約）
export {
  RoomStatusSchema,
  ParticipantRoleSchema,
  ParticipantSchema,
  RoomStateSchema,
} from "./schemas";

export type {
  RoomStatus,
  ParticipantRole,
  Participant,
  RoomState,
} from "./schemas";

// Error codes
export { RoomErrorCode } from "./errors";
export type { RoomErrorCode as RoomErrorCodeType } from "./errors";

// Repository interfaces（apps/server 側での実装用）
export type { RoomRepository } from "./repositories/room-repository";
export type { ParticipantRepository } from "./repositories/participant-repository";

// EventBus interface
export type { EventBus, RoomDomainEvent } from "./event-bus";

// Domain Events
export type { RoomCreatedEvent } from "./events/room-created";
export type { ParticipantJoinedEvent } from "./events/participant-joined";
export type { ParticipantLeftEvent } from "./events/participant-left";
