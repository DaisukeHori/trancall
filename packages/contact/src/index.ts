/**
 * @trancall/contact — Public API
 *
 * 外部に公開するのは Facade インターフェース、スキーマ、ファクトリ関数のみ。
 * 内部実装 (services/, repositories/) への直接アクセスは禁止。
 */

// Facade
export type { ContactFacade } from "./facade";
export { createContactFacade } from "./facade";

// スキーマ / 型
export type {
  PublicProfile,
  ContactEntry,
  AddContactCommand,
  BlockUserCommand,
  ReportUserCommand,
} from "./schemas";
export {
  PublicProfileSchema,
  ContactEntrySchema,
  AddContactCommandSchema,
  BlockUserCommandSchema,
  ReportUserCommandSchema,
} from "./schemas";

// サービスファクトリ（DI 用）
export { createContactService } from "./services/contact-service";
export type { ContactService } from "./services/contact-service";

export { createBlockService } from "./services/block-service";
export type { BlockService } from "./services/block-service";

export { createSearchService } from "./services/search-service";
export type { SearchService } from "./services/search-service";

export { createReportService } from "./services/report-service";
export type { ReportService } from "./services/report-service";

export { createInviteService } from "./services/invite-service";
export type { InviteService } from "./services/invite-service";

// リポジトリインターフェース（DI 用）
export type { ContactRepository } from "./repositories/contact-repository";
export type { BlockRepository } from "./repositories/block-repository";
export type { InviteRepository } from "./repositories/invite-repository";
export type { ProfileSearchRepository } from "./repositories/profile-search-repository";
export type { ReportRepository } from "./repositories/report-repository";
