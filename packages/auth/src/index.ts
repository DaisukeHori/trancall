export { ProfileSchema } from "./schemas.js";
export type { Profile } from "./schemas.js";

export { createAuthFacade } from "./facade.js";
export type {
  AuthFacade,
  ProfileRepository,
  ConsentRepository,
  LegalDocumentVersionRepository,
  AuthEventBus,
  CreateAuthFacadeOptions,
} from "./facade.js";

export {
  AuthConsentRecordedEventSchema,
  AuthConsentRevokedEventSchema,
} from "./events.js";
export type {
  AuthConsentRecordedEvent,
  AuthConsentRevokedEvent,
  AuthDomainEvent,
} from "./events.js";

export { createSupabaseConsentRepository } from "./adapters/supabase-consent-repository.js";
export type { SupabaseClientLike as ConsentSupabaseClientLike } from "./adapters/supabase-consent-repository.js";

export { createSupabaseLegalDocumentVersionRepository } from "./adapters/supabase-legal-document-version-repository.js";
export type { SupabaseClientLike as LegalDocSupabaseClientLike } from "./adapters/supabase-legal-document-version-repository.js";
