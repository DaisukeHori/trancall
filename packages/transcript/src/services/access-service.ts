/**
 * AccessService
 *
 * transcript_access の操作を担当する。
 * - deleteAccess: 自分の deleted_at をセット、相手のアクセスは維持
 * - canView: can_view=true AND deleted_at IS NULL チェック
 */

import { type Result, ok } from "@trancall/shared-kernel";
import type { RoomId, UserId } from "@trancall/shared-kernel";
import type { AccessRepository } from "../repositories/access-repository";

export interface AccessService {
  /**
   * 指定ユーザーが指定 Room の transcript を閲覧できるかチェックする。
   * 閲覧不可の場合は ok(false) を返す（エラーではない）。
   */
  canView(roomId: RoomId, userId: UserId): Promise<Result<boolean>>;

  /**
   * 自分の transcript_access を論理削除する。
   * deleted_at を now() にセットする。相手側のアクセス行には触れない。
   * アクセス行が存在しない場合は NOT_FOUND エラーを返す。
   */
  deleteAccess(roomId: RoomId, userId: UserId): Promise<Result<true>>;
}

export function createAccessService(repo: AccessRepository): AccessService {
  return {
    canView: async (roomId: RoomId, userId: UserId) => {
      return repo.canView(roomId, userId);
    },

    deleteAccess: async (roomId: RoomId, userId: UserId) => {
      // まずアクセス行の存在確認
      const findResult = await repo.findOne(roomId, userId);
      if (!findResult.ok) {
        return findResult;
      }

      const access = findResult.data;

      // 既に削除済みの場合は冪等に ok を返す
      if (access.deletedAt !== null) {
        return ok(true);
      }

      return repo.softDelete(roomId, userId);
    },
  };
}
