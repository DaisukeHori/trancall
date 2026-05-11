/**
 * @trancall/room — Public API
 *
 * 外部モジュールはこのファイルが export するシンボルのみ利用できる。
 * services / repositories / events への直接 import は禁止。
 */

// Facade（唯一の外部エントリポイント）
export { createRoomFacade } from "./facade.js";
export type { RoomFacade, RoomFacadeDeps } from "./facade.js";

// Schemas（モジュール境界の契約）
export {
  RoomStatusSchema,
  ParticipantRoleSchema,
  ParticipantSchema,
  RoomStateSchema,
} from "./schemas.js";

export type {
  RoomStatus,
  ParticipantRole,
  Participant,
  RoomState,
} from "./schemas.js";

// Error codes
export { RoomErrorCode } from "./errors.js";
export type { RoomErrorCode as RoomErrorCodeType } from "./errors.js";

// Repository interfaces（apps/server 側での実装用）
export type { RoomRepository } from "./repositories/room-repository.js";
export type { ParticipantRepository } from "./repositories/participant-repository.js";

// EventBus interface
export type { EventBus, RoomDomainEvent } from "./event-bus.js";

// Domain Events
export type { RoomCreatedEvent } from "./events/room-created.js";
export type { ParticipantJoinedEvent } from "./events/participant-joined.js";
export type { ParticipantLeftEvent } from "./events/participant-left.js";
