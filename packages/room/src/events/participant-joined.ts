/**
 * room.participant_joined イベント
 *
 * joinCall 成功時に EventBus 経由で発行される。
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";
import {
  DomainEventBase, RoomIdSchema, UserIdSchema,
  type RoomId, type UserId,
} from "@trancall/shared-kernel";
import { ParticipantRoleSchema } from "../schemas";

export const ParticipantJoinedPayloadSchema = z.object({
  roomId: RoomIdSchema,
  userId: UserIdSchema,
  role: ParticipantRoleSchema,
  joinedAt: z.iso.datetime(),
});
export type ParticipantJoinedPayload = z.infer<typeof ParticipantJoinedPayloadSchema>;

export const ParticipantJoinedEventSchema = DomainEventBase.extend({
  type: z.literal("room.participant_joined"),
  payload: ParticipantJoinedPayloadSchema,
});

export type ParticipantJoinedEvent = z.infer<typeof ParticipantJoinedEventSchema>;

export function createParticipantJoinedEvent(params: {
  roomId: RoomId;
  userId: UserId;
  role: "host" | "member";
  joinedAt: string;
}): ParticipantJoinedEvent {
  return {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    aggregateId: params.roomId,
    type: "room.participant_joined",
    payload: {
      roomId: params.roomId,
      userId: params.userId,
      role: params.role,
      joinedAt: params.joinedAt,
    },
  };
}
