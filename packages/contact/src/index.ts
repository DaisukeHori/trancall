/**
 * @trancall/contact — Public API
 *
 * 外部に公開するのは Facade インターフェース、スキーマ、ファクトリ関数のみ。
 * 内部実装 (services/, repositories/) への直接アクセスは禁止。
 */

// Facade
export type { ContactFacade } from "./facade.ts";
export { createContactFacade } from "./facade.ts";

// スキーマ / 型
export type {
  PublicProfile,
  ContactEntry,
  AddContactCommand,
  BlockUserCommand,
  ReportUserCommand,
} from "./schemas.ts";
export {
  PublicProfileSchema,
  ContactEntrySchema,
  AddContactCommandSchema,
  BlockUserCommandSchema,
  ReportUserCommandSchema,
} from "./schemas.ts";

// サービスファクトリ（DI 用）
export { createContactService } from "./services/contact-service.ts";
export type { ContactService } from "./services/contact-service.ts";

export { createBlockService } from "./services/block-service.ts";
export type { BlockService } from "./services/block-service.ts";

export { createSearchService } from "./services/search-service.ts";
export type { SearchService } from "./services/search-service.ts";

export { createReportService } from "./services/report-service.ts";
export type { ReportService } from "./services/report-service.ts";

export { createInviteService } from "./services/invite-service.ts";
export type { InviteService } from "./services/invite-service.ts";

// リポジトリインターフェース（DI 用）
export type { ContactRepository } from "./repositories/contact-repository.ts";
export type { BlockRepository } from "./repositories/block-repository.ts";
export type { InviteRepository } from "./repositories/invite-repository.ts";
export type { ProfileSearchRepository } from "./repositories/profile-search-repository.ts";
export type { ReportRepository } from "./repositories/report-repository.ts";
