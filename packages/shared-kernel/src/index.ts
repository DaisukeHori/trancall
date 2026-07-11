export {
  UserIdSchema, RoomIdSchema, TrackIdSchema, ParticipantIdSchema,
  TranslationSessionIdSchema, LiveKitTrackSidSchema, OpenAISessionIdSchema,
  brandUserId, brandRoomId, brandParticipantId, brandTrackId,
  brandTranslationSessionId, brandLiveKitTrackSid, brandOpenAISessionId,
} from "./schemas/brand.ts";

export type {
  UserId, RoomId, TrackId, ParticipantId, TranslationSessionId,
  LiveKitTrackSid, OpenAISessionId,
} from "./schemas/brand.ts";

export {
  AppError, validate, ok, err,
} from "./schemas/result.ts";

export type {
  Result, ResultOk, ResultErr, ResultOf,
} from "./schemas/result.ts";

export {
  OutputLanguage, InputLanguage,
} from "./schemas/language.ts";

export {
  DomainEventBase,
} from "./schemas/events.ts";

export {
  ConsentScopeSchema,
  LegalDocumentVersionSchema,
  ConsentRecordSchema,
  RequiredConsentViewSchema,
} from "./schemas/consent.ts";

export type {
  ConsentScope,
  LegalDocumentVersion,
  ConsentRecord,
  RequiredConsentView,
} from "./schemas/consent.ts";

// Mobile-only: PERMISSION_* error codes (server には伝播しない)
export {
  PERMISSION_ERROR_CODES,
  PERMISSION_ERROR_CODE_VALUES,
  isPermissionErrorCode,
} from "./schemas/permission-error-codes.ts";

export type {
  PermissionErrorCode,
} from "./schemas/permission-error-codes.ts";

// L-9 (G-10 解消): Native Call Bridge canonical schema
// (apps/mobile/modules/call-bridge と packages/notification の単一ソース)
export {
  CallStateSchema,
  CallRoomTypeSchema,
  CallEventSchema,
  IncomingCallPushPayloadSchema,
} from "./schemas/native-call.ts";

export type {
  CallState,
  CallRoomType,
  CallEvent,
  IncomingCallPushPayload,
} from "./schemas/native-call.ts";
