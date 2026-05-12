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
} from "./schemas.js";

export type {
  LiveSubtitleDelta,
  TranscriptSegment,
  TranscriptAccess,
  FullTranscript,
} from "./schemas.js";

// Facade
export { createTranscriptFacade } from "./facade.js";
export type { TranscriptFacade, RoomMetaProvider } from "./facade.js";

// Repository interfaces (for DI wiring in apps/server)
export type { SegmentRepository } from "./repositories/segment-repository.js";
export type { AccessRepository } from "./repositories/access-repository.js";

// Service utilities (for apps/server retention calculation)
export {
  calcRetentionUntil,
  calcRetentionUntilByPlan,
  RETENTION_DAYS,
} from "./services/segment-service.js";
export type { PlanTierKey } from "./services/segment-service.js";

// Export format type and related types
export type { ExportFormat, ExportInput, ExportResult, RoomMeta } from "./services/export-service.js";
