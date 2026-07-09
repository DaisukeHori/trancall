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
} as const;

export type RoomErrorCode = (typeof RoomErrorCode)[keyof typeof RoomErrorCode];
