/**
 * room.participant_joined イベント
 *
 * joinCall 成功時に EventBus 経由で発行される。
 */

import { z } from "zod";
import {
  DomainEventBase, RoomIdSchema, UserIdSchema,
  type RoomId, type UserId,
} from "@trancall/shared-kernel";
import { ParticipantRoleSchema } from "../schemas.js";

export const ParticipantJoinedEventSchema = DomainEventBase.extend({
  type: z.literal("room.participant_joined"),
  roomId: RoomIdSchema,
  userId: UserIdSchema,
  role: ParticipantRoleSchema,
  joinedAt: z.string().datetime(),
});

export type ParticipantJoinedEvent = z.infer<typeof ParticipantJoinedEventSchema>;

export function createParticipantJoinedEvent(params: {
  eventId: string;
  roomId: RoomId;
  userId: UserId;
  role: "host" | "member";
  joinedAt: string;
}): ParticipantJoinedEvent {
  return {
    eventId: params.eventId,
    occurredAt: new Date().toISOString(),
    aggregateId: params.roomId,
    type: "room.participant_joined",
    roomId: params.roomId,
    userId: params.userId,
    role: params.role,
    joinedAt: params.joinedAt,
  };
}
