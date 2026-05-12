export { ProfileSchema } from "./schemas.js";
export type { Profile } from "./schemas.js";

export { createAuthFacade } from "./facade.js";
export type {
  AuthFacade,
  ProfileRepository,
  ConsentScope,
  ConsentSource,
  RecordConsentCommand,
  RequiredConsentView,
} from "./facade.js";
