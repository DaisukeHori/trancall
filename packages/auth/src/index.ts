export { ProfileSchema } from "./schemas.js";
export type { Profile } from "./schemas.js";

export { createAuthFacade } from "./facade.js";
export type {
  AuthFacade,
  AuthFacadeOptions,
  ProfileRepository,
  ConsentRepository,
  LegalDocumentVersionRepository,
  AuthEventBus,
} from "./facade.js";
