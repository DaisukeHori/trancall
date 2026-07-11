export { ProfileSchema } from "./schemas.ts";
export type { Profile } from "./schemas.ts";

export { createAuthFacade } from "./facade.ts";
export type {
  AuthFacade,
  ProfileRepository,
  ConsentRepository,
  LegalDocumentVersionRepository,
  ProfileWriteRepository,
  ProfileUpdateFields,
  LegacyConsentRepository,
  ProfileDeletionRepository,
  ProfileDeletionStatus,
  AuthEventBus,
  CreateAuthFacadeOptions,
} from "./facade.ts";

export {
  AuthUserRegisteredEventSchema,
  AuthConsentRecordedEventSchema,
  AuthConsentRevokedEventSchema,
} from "./events.ts";
export type {
  AuthUserRegisteredEvent,
  AuthConsentRecordedEvent,
  AuthConsentRevokedEvent,
  AuthDomainEvent,
} from "./events.ts";

export { createSupabaseConsentRepository } from "./adapters/supabase-consent-repository.ts";
export type { SupabaseClientLike as ConsentSupabaseClientLike } from "./adapters/supabase-consent-repository.ts";

export { createSupabaseLegalDocumentVersionRepository } from "./adapters/supabase-legal-document-version-repository.ts";
export type { SupabaseClientLike as LegalDocSupabaseClientLike } from "./adapters/supabase-legal-document-version-repository.ts";
