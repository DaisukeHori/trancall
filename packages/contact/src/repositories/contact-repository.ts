/**
 * ContactRepository — 連絡先データアクセスインターフェース
 */

import type { Result } from "@trancall/shared-kernel";
import type { UserId } from "@trancall/shared-kernel";
import type { ContactEntry } from "../schemas.ts";

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
   *
   * Issue #72.2: DB エラー時は Result.err で伝播する
   * (「連絡先 0 件」と「取得失敗」を呼び出し元が区別できるようにするため)。
   */
  list(userId: UserId): Promise<Result<ContactEntry[]>>;

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
