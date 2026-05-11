/**
 * translation.started DomainEvent ファクトリ
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  DomainEventBase,
  TranslationSessionIdSchema,
  RoomIdSchema,
  ParticipantIdSchema,
  InputLanguage,
  OutputLanguage,
} from "@trancall/shared-kernel";

export const TranslationStartedEventSchema = DomainEventBase.extend({
  type: z.literal("translation.started"),
  payload: z.object({
    sessionId: TranslationSessionIdSchema,
    roomId: RoomIdSchema,
    sourceParticipantId: ParticipantIdSchema,
    targetParticipantId: ParticipantIdSchema,
    inputLanguage: InputLanguage,
    outputLanguage: OutputLanguage,
  }),
});
export type TranslationStartedEvent = z.infer<typeof TranslationStartedEventSchema>;

export function createTranslationStartedEvent(
  payload: TranslationStartedEvent["payload"],
): TranslationStartedEvent {
  return {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    aggregateId: payload.sessionId,
    type: "translation.started",
    payload,
  };
}
