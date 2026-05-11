/**
 * @trancall/translation — Public API
 *
 * Server 側で使用するモジュール境界。
 * Facade と Zod スキーマのみエクスポートする。
 * 内部実装（services/, repositories/）への直接 import は禁止。
 */

// Facade
export { createTranslationFacade } from "./facade.js";
export type { TranslationFacade, TranslationFacadeDeps } from "./facade.js";

// Schemas (公開)
export {
  LiveSubtitleDeltaSchema,
  TranslationSessionRecordSchema,
  AgentMetricsRecordSchema,
  AgentEventSchema,
  SessionStartedPayloadSchema,
  SessionEndedPayloadSchema,
  TranscriptDeltaPayloadSchema,
  AgentMetricsPayloadSchema,
  TranslationUsageSchema,
} from "./schemas.js";

export type {
  LiveSubtitleDelta,
  TranslationSessionRecord,
  AgentMetricsRecord,
  AgentEvent,
  SessionStartedPayload,
  SessionEndedPayload,
  TranscriptDeltaPayload,
  AgentMetricsPayload,
  TranslationUsage,
} from "./schemas.js";

// Repository interfaces (Server インフラ層で実装する)
export type { TranslationSessionRepository } from "./repositories/translation-session-repository.js";
export type { AgentMetricsRepository } from "./repositories/agent-metrics-repository.js";
export type { TranslationEventOutboxRepository, OutboxRecord } from "./repositories/translation-event-outbox-repository.js";

// Domain Events
export {
  TranslationStartedEventSchema,
  createTranslationStartedEvent,
} from "./events/translation-started.js";
export type { TranslationStartedEvent } from "./events/translation-started.js";

export {
  TranslationEndedEventSchema,
  createTranslationEndedEvent,
} from "./events/translation-ended.js";
export type { TranslationEndedEvent } from "./events/translation-ended.js";

// Utilities (re-export for convenience)
export { shouldStartSession } from "./services/language-pair.js";
export { calcBillableSeconds, calcUsageFromRecord } from "./services/usage-calculator.js";
