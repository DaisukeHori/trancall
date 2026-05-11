/**
 * ContactRepository — 連絡先データアクセスインターフェース
 */

import type { Result } from "@trancall/shared-kernel";
import type { UserId } from "@trancall/shared-kernel";
import type { ContactEntry } from "../schemas.js";

export interface ContactRepository {
  /**
   * 連絡先を追加する。
   * @returns 追加された ContactEntry
   */
  add(
    userId: UserId,
    contactUserId: UserId,
  ): Promise<Result<ContactEntry>>;

  /**
   * 連絡先を削除する。
   * @param userId 操作するユーザー
   * @param contactId contacts テーブルの UUID (contactId)
   */
  remove(
    userId: UserId,
    contactId: string,
  ): Promise<Result<true>>;

  /**
   * 連絡先一覧を取得する。
   */
  list(userId: UserId): Promise<ContactEntry[]>;

  /**
   * すでに連絡先として存在するか確認する。
   */
  exists(
    userId: UserId,
    contactUserId: UserId,
  ): Promise<boolean>;

  /**
   * お気に入りをトグルする。
   */
  toggleFavorite(
    userId: UserId,
    contactId: string,
  ): Promise<Result<true>>;
}
