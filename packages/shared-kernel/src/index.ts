export {
  UserIdSchema, RoomIdSchema, TrackIdSchema, ParticipantIdSchema,
  TranslationSessionIdSchema, LiveKitTrackSidSchema, OpenAISessionIdSchema,
  brandUserId, brandRoomId, brandParticipantId, brandTrackId,
  brandTranslationSessionId, brandLiveKitTrackSid, brandOpenAISessionId,
} from "./schemas/brand.js";

export type {
  UserId, RoomId, TrackId, ParticipantId, TranslationSessionId,
  LiveKitTrackSid, OpenAISessionId,
} from "./schemas/brand.js";

export {
  AppError, validate, ok, err,
} from "./schemas/result.js";

export type {
  Result, ResultOk, ResultErr, ResultOf,
} from "./schemas/result.js";

export {
  OutputLanguage, InputLanguage,
} from "./schemas/language.js";

export {
  DomainEventBase,
} from "./schemas/events.js";

// Mobile-only: PERMISSION_* error codes (server には伝播しない)
export {
  PERMISSION_ERROR_CODES,
  PERMISSION_ERROR_CODE_VALUES,
  isPermissionErrorCode,
} from "./schemas/permission-error-codes.js";

export type {
  PermissionErrorCode,
} from "./schemas/permission-error-codes.js";
