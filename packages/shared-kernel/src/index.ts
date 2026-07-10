export {
  UserIdSchema, RoomIdSchema, TrackIdSchema, ParticipantIdSchema,
  TranslationSessionIdSchema, LiveKitTrackSidSchema, OpenAISessionIdSchema,
  brandUserId, brandRoomId, brandParticipantId, brandTrackId,
  brandTranslationSessionId, brandLiveKitTrackSid, brandOpenAISessionId,
} from "./schemas/brand";

export type {
  UserId, RoomId, TrackId, ParticipantId, TranslationSessionId,
  LiveKitTrackSid, OpenAISessionId,
} from "./schemas/brand";

export {
  AppError, validate, ok, err,
} from "./schemas/result";

export type {
  Result, ResultOk, ResultErr, ResultOf,
} from "./schemas/result";

export {
  OutputLanguage, InputLanguage,
} from "./schemas/language";

export {
  DomainEventBase,
} from "./schemas/events";

export {
  ConsentScopeSchema,
  LegalDocumentVersionSchema,
  ConsentRecordSchema,
  RequiredConsentViewSchema,
} from "./schemas/consent";

export type {
  ConsentScope,
  LegalDocumentVersion,
  ConsentRecord,
  RequiredConsentView,
} from "./schemas/consent";

// Mobile-only: PERMISSION_* error codes (server には伝播しない)
export {
  PERMISSION_ERROR_CODES,
  PERMISSION_ERROR_CODE_VALUES,
  isPermissionErrorCode,
} from "./schemas/permission-error-codes";

export type {
  PermissionErrorCode,
} from "./schemas/permission-error-codes";
