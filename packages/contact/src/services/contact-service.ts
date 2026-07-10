/**
 * ContactService — 連絡先管理ドメインサービス
 */

import {
  type Result,
  type UserId,
  err,
} from "@trancall/shared-kernel";

import type { ContactEntry } from "../schemas.ts";
import type { ContactRepository } from "../repositories/contact-repository.ts";
import type { BlockRepository } from "../repositories/block-repository.ts";

export interface ContactService {
  addContact(
    userId: UserId,
    contactUserId: UserId,
  ): Promise<Result<ContactEntry>>;

  removeContact(
    userId: UserId,
    contactId: string,
  ): Promise<Result<true>>;

  listContacts(userId: UserId): Promise<ContactEntry[]>;

  toggleFavorite(
    userId: UserId,
    contactId: string,
  ): Promise<Result<true>>;
}

export function createContactService(
  contactRepo: ContactRepository,
  blockRepo: BlockRepository,
): ContactService {
  return {
    addContact: async (
      userId: UserId,
      contactUserId: UserId,
    ): Promise<Result<ContactEntry>> => {
      // 自分自身は追加不可
      if (userId === contactUserId) {
        return err({
          code: "CONTACT_SELF_ADD",
          message: "自分を連絡先に追加できません",
          retryable: false,
          httpStatus: 400,
        });
      }

      // ブロック済みチェック（双方向）
      const blocked = await blockRepo.isBlocked(userId, contactUserId);
      if (blocked) {
        return err({
          code: "CONTACT_USER_BLOCKED",
          message: "この操作は実行できません",
          retryable: false,
          httpStatus: 403,
        });
      }

      // 重複チェック
      const exists = await contactRepo.exists(userId, contactUserId);
      if (exists) {
        return err({
          code: "CONTACT_ALREADY_EXISTS",
          message: "すでに連絡先に追加されています",
          retryable: false,
          httpStatus: 409,
        });
      }

      return contactRepo.add(userId, contactUserId);
    },

    removeContact: async (
      userId: UserId,
      contactId: string,
    ): Promise<Result<true>> => {
      return contactRepo.remove(userId, contactId);
    },

    listContacts: async (userId: UserId): Promise<ContactEntry[]> => {
      return contactRepo.list(userId);
    },

    toggleFavorite: async (
      userId: UserId,
      contactId: string,
    ): Promise<Result<true>> => {
      return contactRepo.toggleFavorite(userId, contactId);
    },
  };
}
