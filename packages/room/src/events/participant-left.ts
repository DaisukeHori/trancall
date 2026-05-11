/**
 * room.participant_left イベント
 *
 * endCall 時に参加者が退出した際に EventBus 経由で発行される。
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";
import {
  DomainEventBase, RoomIdSchema, UserIdSchema,
  type RoomId, type UserId,
} from "@trancall/shared-kernel";

export const ParticipantLeftPayloadSchema = z.object({
  roomId: RoomIdSchema,
  userId: UserIdSchema,
  leftAt: z.string().datetime(),
});
export type ParticipantLeftPayload = z.infer<typeof ParticipantLeftPayloadSchema>;

export const ParticipantLeftEventSchema = DomainEventBase.extend({
  type: z.literal("room.participant_left"),
  payload: ParticipantLeftPayloadSchema,
});

export type ParticipantLeftEvent = z.infer<typeof ParticipantLeftEventSchema>;

export function createParticipantLeftEvent(params: {
  roomId: RoomId;
  userId: UserId;
  leftAt: string;
}): ParticipantLeftEvent {
  return {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    aggregateId: params.roomId,
    type: "room.participant_left",
    payload: {
      roomId: params.roomId,
      userId: params.userId,
      leftAt: params.leftAt,
    },
  };
}
