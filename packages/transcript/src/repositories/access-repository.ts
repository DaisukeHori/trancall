/**
 * AccessRepository — interface
 *
 * transcript_access テーブルへのデータアクセス抽象。
 */

import type { Result } from "@trancall/shared-kernel";
import type { RoomId, UserId } from "@trancall/shared-kernel";
import type { TranscriptAccess } from "../schemas";

export interface AccessRepository {
  /**
   * 指定ユーザーが指定 Room の transcript を閲覧できるかチェックする。
   * can_view=true AND deleted_at IS NULL の行が存在する場合 true。
   */
  canView(roomId: RoomId, userId: UserId): Promise<Result<boolean>>;

  /**
   * 指定ユーザーの transcript_access.deleted_at を now() に設定する。
   * 相手のアクセス行には一切触れない。
   */
  softDelete(roomId: RoomId, userId: UserId): Promise<Result<true>>;

  /**
   * アクセス行を取得する（存在しない場合は NOT_FOUND）。
   */
  findOne(
    roomId: RoomId,
    userId: UserId,
  ): Promise<Result<TranscriptAccess>>;
}
