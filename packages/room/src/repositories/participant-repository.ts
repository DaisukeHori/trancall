/**
 * ParticipantRepository — DB 操作の抽象インターフェース (DI 要求)
 *
 * 具体実装は apps/server 側で Supabase ベースで提供する。
 * trancall_room.participants テーブルへのアクセスを管理する。
 */

import type { Result, RoomId } from "@trancall/shared-kernel";
import type { ParticipantRow, UpsertParticipantCommand } from "../schemas.js";

export interface ParticipantRepository {
  /**
   * UNIQUE(room_id, user_id) に基づいて upsert する。
   * 既存なら joined_at / role を更新して返す（冪等）。
   */
  upsert(cmd: UpsertParticipantCommand): Promise<Result<ParticipantRow>>;

  /**
   * room_id に属する全参加者を取得する。
   */
  findByRoomId(roomId: RoomId): Promise<Result<ParticipantRow[]>>;

  /**
   * まだ left_at が未設定の参加者全員の left_at を now に更新する。
   */
  setLeftAtForAll(roomId: RoomId, leftAt: string): Promise<Result<true>>;
}
