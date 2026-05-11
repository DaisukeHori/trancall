/**
 * translation.ended DomainEvent ファクトリ
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  DomainEventBase,
  TranslationSessionIdSchema,
  RoomIdSchema,
  ParticipantIdSchema,
  OutputLanguage,
} from "@trancall/shared-kernel";

export const TranslationEndedEventSchema = DomainEventBase.extend({
  type: z.literal("translation.ended"),
  payload: z.object({
    sessionId: TranslationSessionIdSchema,
    roomId: RoomIdSchema,
    sourceParticipantId: ParticipantIdSchema,
    outputLanguage: OutputLanguage,
    durationMs: z.number().int().nonnegative(),
    billableSeconds: z.number().int().nonnegative(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    reason: z.enum([
      "participant_left",
      "agent_shutdown",
      "openai_fatal_error",
      "client_requested",
    ]),
  }),
});
export type TranslationEndedEvent = z.infer<typeof TranslationEndedEventSchema>;

export function createTranslationEndedEvent(
  payload: TranslationEndedEvent["payload"],
): TranslationEndedEvent {
  return {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    aggregateId: payload.sessionId,
    type: "translation.ended",
    payload,
  };
}
