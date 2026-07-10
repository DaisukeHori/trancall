/**
 * RoomRepository — DB 操作の抽象インターフェース (DI 要求)
 *
 * 具体実装は apps/server 側で Supabase ベースで提供する。
 */

import type { Result, RoomId } from "@trancall/shared-kernel";
import type { RoomRow, InsertRoomCommand } from "../schemas";

export interface RoomRepository {
  /**
   * rooms テーブルに新規行を挿入する。
   */
  insert(cmd: InsertRoomCommand): Promise<Result<RoomRow>>;

  /**
   * room_id で rooms 行を取得する。
   * 存在しない場合は ROOM_NOT_FOUND エラーを返す。
   */
  findById(roomId: RoomId): Promise<Result<RoomRow>>;

  /**
   * status を更新する。
   */
  updateStatus(
    roomId: RoomId,
    status: "active" | "ended",
    endedAt?: string,
  ): Promise<Result<RoomRow>>;
}
