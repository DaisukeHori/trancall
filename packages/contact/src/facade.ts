/**
 * ContactFacade — contact モジュールの唯一の外部エントリポイント
 *
 * 他のモジュールはこのファサード経由でのみ contact モジュールを利用できる。
 */

import type { Result, AppError, UserId } from "@trancall/shared-kernel";

import type { ContactEntry, PublicProfile } from "./schemas.js";
import type { BlockUserCommand, ReportUserCommand, AddContactCommand } from "./schemas.js";
import type { ContactService } from "./services/contact-service.js";
import type { BlockService } from "./services/block-service.js";
import type { SearchService } from "./services/search-service.js";
import type { ReportService } from "./services/report-service.js";
import type { InviteService } from "./services/invite-service.js";

export interface ContactFacade {
  addContact(cmd: AddContactCommand): Promise<Result<ContactEntry, AppError>>;
  removeContact(userId: UserId, contactId: string): Promise<Result<true, AppError>>;
  listContacts(userId: UserId): Promise<ContactEntry[]>;
  searchUsers(query: string, callerId: UserId): Promise<PublicProfile[]>;
  blockUser(cmd: BlockUserCommand): Promise<Result<true, AppError>>;
  unblockUser(userId: UserId, blockedUserId: UserId): Promise<Result<true, AppError>>;
  reportUser(cmd: ReportUserCommand): Promise<Result<true, AppError>>;
  toggleFavorite(userId: UserId, contactId: string): Promise<Result<true, AppError>>;
  createInviteLink(
    userId: UserId,
  ): Promise<Result<{ url: string; token: string; expiresAt: string }, AppError>>;
  consumeInviteLink(
    token: string,
    newUserId: UserId,
  ): Promise<Result<ContactEntry, AppError>>;
}

export function createContactFacade(
  contactService: ContactService,
  blockService: BlockService,
  searchService: SearchService,
  reportService: ReportService,
  inviteService: InviteService,
): ContactFacade {
  return {
    addContact: (cmd: AddContactCommand) =>
      contactService.addContact(cmd.userId, cmd.contactUserId),

    removeContact: (userId: UserId, contactId: string) =>
      contactService.removeContact(userId, contactId),

    listContacts: (userId: UserId) =>
      contactService.listContacts(userId),

    searchUsers: (query: string, callerId: UserId) =>
      searchService.searchUsers(query, callerId),

    blockUser: (cmd: BlockUserCommand) =>
      blockService.blockUser(cmd),

    unblockUser: (userId: UserId, blockedUserId: UserId) =>
      blockService.unblockUser(userId, blockedUserId),

    reportUser: (cmd: ReportUserCommand) =>
      reportService.reportUser(cmd),

    toggleFavorite: (userId: UserId, contactId: string) =>
      contactService.toggleFavorite(userId, contactId),

    createInviteLink: (userId: UserId) =>
      inviteService.createInviteLink(userId),

    consumeInviteLink: (token: string, newUserId: UserId) =>
      inviteService.consumeInviteLink(token, newUserId),
  };
}
