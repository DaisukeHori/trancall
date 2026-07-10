/**
 * ParticipantRepository — DB 操作の抽象インターフェース (DI 要求)
 *
 * 具体実装は apps/server 側で Supabase ベースで提供する。
 * trancall_room.participants テーブルへのアクセスを管理する。
 */

import type { Result, RoomId, UserId } from "@trancall/shared-kernel";
import type { ParticipantRow, UpsertParticipantCommand } from "../schemas";

export interface ParticipantRepository {
  /**
   * UNIQUE(room_id, user_id) に基づいて upsert する。
   * 既存なら joined_at / role を更新して返す（冪等）。
   *
   * 確定#2: createCall の invitee 事前登録 (joinedAt: null) にも使う。
   * join 時の role 保持 (host 降格防止) には markJoined を使うこと —
   * upsert は role を含む全列を書き換えるため join の実装には使わない。
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

  /**
   * 確定#2: room_id + user_id に一致する参加者行を 1 件取得する。
   * 存在しない場合はエラーではなく data: null を返す
   * (「招待されていないユーザーの join 試行」を判定するために使う)。
   */
  findOne(roomId: RoomId, userId: UserId): Promise<Result<ParticipantRow | null>>;

  /**
   * 確定#2: 既存の participant 行の joined_at のみを更新する (role は変更しない)。
   * host の再 join で role が member に降格しないようにするため、
   * upsert (全列書き換え) ではなく本メソッドを使う。
   * 対象行が存在しない場合は ROOM_USER_NOT_INVITED を返す。
   */
  markJoined(roomId: RoomId, userId: UserId, joinedAt: string): Promise<Result<ParticipantRow>>;
}
