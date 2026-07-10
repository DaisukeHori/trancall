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
import { TranslationSessionEndedReasonSchema } from "../schemas.ts";

// #46/#49: reason は SessionEndedPayloadSchema / TranslationUsageSchema と同じ
// TranslationSessionEndedReasonSchema (5 値、agent_publish_failed 含む) を参照する。
// 以前はこのファイル内に 4 値だけの独自 z.enum を持っており、agent_publish_failed で
// 終了したセッションが translation.ended を publish できず (apps/server/src/routes/agent-routes.ts
// が reason 未対応として publish 自体をスキップしていた)、#46 usage metering の対象から漏れて
// いた。canonical な enum を再利用することで今後の非同期を防ぐ。
export const TranslationEndedEventSchema = DomainEventBase.extend({
  type: z.literal("translation.ended"),
  payload: z.object({
    sessionId: TranslationSessionIdSchema,
    roomId: RoomIdSchema,
    sourceParticipantId: ParticipantIdSchema,
    outputLanguage: OutputLanguage,
    durationMs: z.number().int().nonnegative(),
    billableSeconds: z.number().int().nonnegative(),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
    reason: TranslationSessionEndedReasonSchema,
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
