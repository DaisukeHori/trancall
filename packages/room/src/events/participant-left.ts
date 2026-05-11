/**
 * room.participant_left イベント
 *
 * endCall 時に参加者が退出した際に EventBus 経由で発行される。
 */

import { z } from "zod";
import {
  DomainEventBase, RoomIdSchema, UserIdSchema,
  type RoomId, type UserId,
} from "@trancall/shared-kernel";

export const ParticipantLeftEventSchema = DomainEventBase.extend({
  type: z.literal("room.participant_left"),
  roomId: RoomIdSchema,
  userId: UserIdSchema,
  leftAt: z.string().datetime(),
});

export type ParticipantLeftEvent = z.infer<typeof ParticipantLeftEventSchema>;

export function createParticipantLeftEvent(params: {
  eventId: string;
  roomId: RoomId;
  userId: UserId;
  leftAt: string;
}): ParticipantLeftEvent {
  return {
    eventId: params.eventId,
    occurredAt: new Date().toISOString(),
    aggregateId: params.roomId,
    type: "room.participant_left",
    roomId: params.roomId,
    userId: params.userId,
    leftAt: params.leftAt,
  };
}
