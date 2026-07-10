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
} from "./schemas.ts";

export type {
  LiveSubtitleDelta,
  TranscriptSegment,
  TranscriptAccess,
  FullTranscript,
} from "./schemas.ts";

// Facade
export { createTranscriptFacade } from "./facade.ts";
export type {
  TranscriptFacade,
  RoomMetaProvider,
  LegalDocVersionRepository,
  TranscriptFacadeDeps,
} from "./facade.ts";

// Repository interfaces (for DI wiring in apps/server)
export type { SegmentRepository } from "./repositories/segment-repository.ts";
export type { AccessRepository } from "./repositories/access-repository.ts";

// Service utilities (for apps/server retention calculation)
export {
  calcRetentionUntil,
  calcRetentionUntilByPlan,
  RETENTION_DAYS,
} from "./services/segment-service.ts";
export type { PlanTierKey } from "./services/segment-service.ts";

// Export format type and related types
export type { ExportFormat, ExportInput, ExportResult, RoomMeta } from "./services/export-service.ts";
