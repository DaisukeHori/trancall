/**
 * RoomRepository — DB 操作の抽象インターフェース (DI 要求)
 *
 * 具体実装は apps/server 側で Supabase ベースで提供する。
 */

import type { Result, RoomId, UserId } from "@trancall/shared-kernel";
import type { RoomRow, InsertRoomCommand } from "../schemas.ts";

/** L-13: findEndedByParticipantId のページング/絞り込みオプション */
export interface FindEndedRoomsOptions {
  /** 返す最大件数 (1-50) */
  limit: number;
  /** 指定時、created_at < before の行のみ返す (前ページの最古 entry の startedAt を渡す想定) */
  before?: string;
  /** 指定時、created_at >= since の行のみ返す (プラン別 retention 上限、docs/api-spec.md) */
  since?: string;
}

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

  /**
   * L-13: 指定ユーザーが参加履歴を持つ (trancall_room.participants に行がある)、
   * status='ended' の room を created_at 降順で返す (通話履歴、docs/api-spec.md
   * GET /api/rooms/history)。
   */
  findEndedByParticipantId(
    userId: UserId,
    opts: FindEndedRoomsOptions,
  ): Promise<Result<RoomRow[]>>;
}
