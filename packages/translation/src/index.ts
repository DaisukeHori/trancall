/**
 * @trancall/translation — Public API
 *
 * Server 側で使用するモジュール境界。
 * Facade と Zod スキーマのみエクスポートする。
 * 内部実装（services/, repositories/）への直接 import は禁止。
 */

// Facade
export { createTranslationFacade } from "./facade";
export type { TranslationFacade, TranslationFacadeDeps } from "./facade";

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
} from "./schemas";

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
} from "./schemas";

// Repository interfaces (Server インフラ層で実装する)
export type { TranslationSessionRepository } from "./repositories/translation-session-repository";
export type { AgentMetricsRepository } from "./repositories/agent-metrics-repository";
export type { TranslationEventOutboxRepository, OutboxRecord } from "./repositories/translation-event-outbox-repository";

// Domain Events
export {
  TranslationStartedEventSchema,
  createTranslationStartedEvent,
} from "./events/translation-started";
export type { TranslationStartedEvent } from "./events/translation-started";

export {
  TranslationEndedEventSchema,
  createTranslationEndedEvent,
} from "./events/translation-ended";
export type { TranslationEndedEvent } from "./events/translation-ended";

// Utilities (re-export for convenience)
export { shouldStartSession } from "./services/language-pair";
export { calcBillableSeconds, calcUsageFromRecord } from "./services/usage-calculator";
