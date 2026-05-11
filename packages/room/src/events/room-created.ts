/**
 * room.created イベント
 *
 * createCall 成功時に EventBus 経由で発行される。
 */

import { z } from "zod";
import {
  DomainEventBase, RoomIdSchema, UserIdSchema,
  type RoomId, type UserId,
} from "@trancall/shared-kernel";

export const RoomCreatedEventSchema = DomainEventBase.extend({
  type: z.literal("room.created"),
  roomId: RoomIdSchema,
  creatorId: UserIdSchema,
  inviteeIds: z.array(UserIdSchema),
  translationEnabled: z.boolean(),
  createdAt: z.string().datetime(),
});

export type RoomCreatedEvent = z.infer<typeof RoomCreatedEventSchema>;

export function createRoomCreatedEvent(params: {
  eventId: string;
  roomId: RoomId;
  creatorId: UserId;
  inviteeIds: UserId[];
  translationEnabled: boolean;
  createdAt: string;
}): RoomCreatedEvent {
  return {
    eventId: params.eventId,
    occurredAt: new Date().toISOString(),
    aggregateId: params.roomId,
    type: "room.created",
    roomId: params.roomId,
    creatorId: params.creatorId,
    inviteeIds: params.inviteeIds,
    translationEnabled: params.translationEnabled,
    createdAt: params.createdAt,
  };
}
