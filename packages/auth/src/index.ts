export { ProfileSchema } from "./schemas";
export type { Profile } from "./schemas";

export { createAuthFacade } from "./facade";
export type {
  AuthFacade,
  ProfileRepository,
  ConsentRepository,
  LegalDocumentVersionRepository,
  AuthEventBus,
  CreateAuthFacadeOptions,
} from "./facade";

export {
  AuthConsentRecordedEventSchema,
  AuthConsentRevokedEventSchema,
} from "./events";
export type {
  AuthConsentRecordedEvent,
  AuthConsentRevokedEvent,
  AuthDomainEvent,
} from "./events";

export { createSupabaseConsentRepository } from "./adapters/supabase-consent-repository";
export type { SupabaseClientLike as ConsentSupabaseClientLike } from "./adapters/supabase-consent-repository";

export { createSupabaseLegalDocumentVersionRepository } from "./adapters/supabase-legal-document-version-repository";
export type { SupabaseClientLike as LegalDocSupabaseClientLike } from "./adapters/supabase-legal-document-version-repository";
