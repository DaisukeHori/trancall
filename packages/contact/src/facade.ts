/**
 * ContactFacade — contact モジュールの唯一の外部エントリポイント
 *
 * 他のモジュールはこのファサード経由でのみ contact モジュールを利用できる。
 */

import type { Result, UserId } from "@trancall/shared-kernel";

import type { ContactEntry, PublicProfile } from "./schemas.ts";
import type { BlockUserCommand, ReportUserCommand, AddContactCommand } from "./schemas.ts";
import type { ContactService } from "./services/contact-service.ts";
import type { BlockService } from "./services/block-service.ts";
import type { SearchService } from "./services/search-service.ts";
import type { ReportService } from "./services/report-service.ts";
import type { InviteService } from "./services/invite-service.ts";

export interface ContactFacade {
  addContact(cmd: AddContactCommand): Promise<Result<ContactEntry>>;
  removeContact(userId: UserId, contactId: string): Promise<Result<true>>;
  listContacts(userId: UserId): Promise<ContactEntry[]>;
  searchUsers(query: string, callerId: UserId): Promise<PublicProfile[]>;
  blockUser(cmd: BlockUserCommand): Promise<Result<true>>;
  unblockUser(userId: UserId, blockedUserId: UserId): Promise<Result<true>>;
  reportUser(cmd: ReportUserCommand): Promise<Result<true>>;
  toggleFavorite(userId: UserId, contactId: string): Promise<Result<true>>;
  createInviteLink(
    userId: UserId,
  ): Promise<Result<{ url: string; token: string; expiresAt: string }>>;
  consumeInviteLink(
    token: string,
    newUserId: UserId,
  ): Promise<Result<ContactEntry>>;
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
