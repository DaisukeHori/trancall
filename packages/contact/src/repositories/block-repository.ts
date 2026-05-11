/**
 * BlockRepository — ブロックリストデータアクセスインターフェース
 */

import type { Result, UserId } from "@trancall/shared-kernel";

export interface BlockRepository {
  /**
   * ユーザーをブロックする。
   */
  block(
    userId: UserId,
    blockedUserId: UserId,
    reason?: string,
  ): Promise<Result<true>>;

  /**
   * ブロックを解除する。
   */
  unblock(
    userId: UserId,
    blockedUserId: UserId,
  ): Promise<Result<true>>;

  /**
   * ブロック済みかどうか確認する（双方向）。
   * A が B をブロック、または B が A をブロックしている場合は true。
   */
  isBlocked(
    userId: UserId,
    targetUserId: UserId,
  ): Promise<boolean>;

  /**
   * 指定ユーザーがブロックしているユーザーIDセットを取得する。
   */
  getBlockedUserIds(userId: UserId): Promise<Set<string>>;
}
