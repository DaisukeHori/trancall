/**
 * EventBus インターフェース (room モジュール内部参照用)
 *
 * 具体実装は apps/server 側で in-process pub/sub として提供される。
 * docs/module-contracts.md Section 3.2 の EventBus 契約に準拠。
 */

import type { RoomCreatedEvent } from "./events/room-created.js";
import type { ParticipantJoinedEvent } from "./events/participant-joined.js";
import type { ParticipantLeftEvent } from "./events/participant-left.js";

export type RoomDomainEvent =
  | RoomCreatedEvent
  | ParticipantJoinedEvent
  | ParticipantLeftEvent;

export interface EventBus {
  publish(event: RoomDomainEvent): Promise<void>;
}
