/**
 * @trancall/contact — Public API
 *
 * 外部に公開するのは Facade インターフェース、スキーマ、ファクトリ関数のみ。
 * 内部実装 (services/, repositories/) への直接アクセスは禁止。
 */

// Facade
export type { ContactFacade } from "./facade.js";
export { createContactFacade } from "./facade.js";

// スキーマ / 型
export type {
  PublicProfile,
  ContactEntry,
  AddContactCommand,
  BlockUserCommand,
  ReportUserCommand,
} from "./schemas.js";
export {
  PublicProfileSchema,
  ContactEntrySchema,
  AddContactCommandSchema,
  BlockUserCommandSchema,
  ReportUserCommandSchema,
} from "./schemas.js";

// サービスファクトリ（DI 用）
export { createContactService } from "./services/contact-service.js";
export type { ContactService } from "./services/contact-service.js";

export { createBlockService } from "./services/block-service.js";
export type { BlockService } from "./services/block-service.js";

export { createSearchService } from "./services/search-service.js";
export type { SearchService } from "./services/search-service.js";

export { createReportService } from "./services/report-service.js";
export type { ReportService } from "./services/report-service.js";

export { createInviteService } from "./services/invite-service.js";
export type { InviteService } from "./services/invite-service.js";

// リポジトリインターフェース（DI 用）
export type { ContactRepository } from "./repositories/contact-repository.js";
export type { BlockRepository } from "./repositories/block-repository.js";
export type { InviteRepository } from "./repositories/invite-repository.js";
export type { ProfileSearchRepository } from "./repositories/profile-search-repository.js";
export type { ReportRepository } from "./repositories/report-repository.js";
