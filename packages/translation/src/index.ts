/**
 * @trancall/translation — Public API
 *
 * Server 側で使用するモジュール境界。
 * Facade と Zod スキーマのみエクスポートする。
 * 内部実装（services/, repositories/）への直接 import は禁止。
 */

// Facade
export { createTranslationFacade } from "./facade.ts";
export type { TranslationFacade, TranslationFacadeDeps } from "./facade.ts";

// Schemas (公開)
export {
  TranslationSessionEndedReasonSchema,
  LiveSubtitleDeltaSchema,
  TranslationSessionRecordSchema,
  AgentMetricsRecordSchema,
  AgentEventSchema,
  SessionStartedPayloadSchema,
  SessionEndedPayloadSchema,
  TranscriptDeltaPayloadSchema,
  AgentMetricsPayloadSchema,
  TranslationDegradedPayloadSchema,
  TranslationRecoveredPayloadSchema,
  TranslationDegradedEventSchema,
  TranslationRecoveredEventSchema,
  TranslationStatusChannelPayloadSchema,
  TranslationUsageSchema,
} from "./schemas.ts";

export type {
  TranslationSessionEndedReason,
  LiveSubtitleDelta,
  TranslationSessionRecord,
  AgentMetricsRecord,
  AgentEvent,
  SessionStartedPayload,
  SessionEndedPayload,
  TranscriptDeltaPayload,
  AgentMetricsPayload,
  TranslationDegradedPayload,
  TranslationRecoveredPayload,
  TranslationDegradedEvent,
  TranslationRecoveredEvent,
  TranslationStatusChannelPayload,
  TranslationUsage,
} from "./schemas.ts";

// Repository interfaces (Server インフラ層で実装する)
export type { TranslationSessionRepository } from "./repositories/translation-session-repository.ts";
export type { AgentMetricsRepository } from "./repositories/agent-metrics-repository.ts";
export type { TranslationEventOutboxRepository, OutboxRecord } from "./repositories/translation-event-outbox-repository.ts";

// Domain Events
export {
  TranslationStartedEventSchema,
  createTranslationStartedEvent,
} from "./events/translation-started.ts";
export type { TranslationStartedEvent } from "./events/translation-started.ts";

export {
  TranslationEndedEventSchema,
  createTranslationEndedEvent,
} from "./events/translation-ended.ts";
export type { TranslationEndedEvent } from "./events/translation-ended.ts";

// Utilities (re-export for convenience)
export { shouldStartSession } from "./services/language-pair.ts";
export { calcBillableSeconds, calcUsageFromRecord } from "./services/usage-calculator.ts";
