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
  BILLING_INSUFFICIENT_BALANCE: "BILLING_INSUFFICIENT_BALANCE",
} as const;

export type RoomErrorCode = (typeof RoomErrorCode)[keyof typeof RoomErrorCode];
