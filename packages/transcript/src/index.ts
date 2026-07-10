/**
 * @trancall/transcript — Public exports
 *
 * 他モジュールはここから import する。
 * services/ や repositories/ への直接アクセスは禁止。
 */

// Schemas (public contract)
export {
  LiveSubtitleDeltaSchema,
  TranscriptSegmentSchema,
  TranscriptAccessSchema,
  FullTranscriptSchema,
} from "./schemas";

export type {
  LiveSubtitleDelta,
  TranscriptSegment,
  TranscriptAccess,
  FullTranscript,
} from "./schemas";

// Facade
export { createTranscriptFacade } from "./facade";
export type {
  TranscriptFacade,
  RoomMetaProvider,
  LegalDocVersionRepository,
  TranscriptFacadeDeps,
} from "./facade";

// Repository interfaces (for DI wiring in apps/server)
export type { SegmentRepository } from "./repositories/segment-repository";
export type { AccessRepository } from "./repositories/access-repository";

// Service utilities (for apps/server retention calculation)
export {
  calcRetentionUntil,
  calcRetentionUntilByPlan,
  RETENTION_DAYS,
} from "./services/segment-service";
export type { PlanTierKey } from "./services/segment-service";

// Export format type and related types
export type { ExportFormat, ExportInput, ExportResult, RoomMeta } from "./services/export-service";
