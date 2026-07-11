/**
 * @trancall/room — モジュール固有エラーコード
 *
 * shared-kernel の AppError の code フィールドに使用する定数群。
 * error-handling.md Section 5: owner=room の予定。
 */

export const RoomErrorCode = {
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  ROOM_ALREADY_ENDED: "ROOM_ALREADY_ENDED",
  ROOM_CREATE_FAILED: "ROOM_CREATE_FAILED",
  ROOM_MEDIA_CREATE_FAILED: "ROOM_MEDIA_CREATE_FAILED",
  // 確定#2: 招待されていないユーザー (participants 行が存在しないユーザー) の
  // 自己エンロール (POST /api/rooms/:id/join) を拒否する際に使う。
  ROOM_USER_NOT_INVITED: "ROOM_USER_NOT_INVITED",
  // Issue #69: createCall (発信) / joinCall (参加) 双方で、当事者間にブロック関係
  // (@trancall/contact 所有 block_list、BlockListRepository 経由で参照) がある場合に使う。
  ROOM_USER_BLOCKED: "ROOM_USER_BLOCKED",
  // Issue #69: joinCall で ROOM_MAX_PARTICIPANTS (constants.ts) を超えて join しようとした
  // 場合に使う。既に join 済みのユーザーの再 join (冪等パス) では発生しない。
  ROOM_FULL: "ROOM_FULL",
} as const;

export type RoomErrorCode = (typeof RoomErrorCode)[keyof typeof RoomErrorCode];
