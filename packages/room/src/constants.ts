/**
 * @trancall/room — 定数
 */

/**
 * ROOM_MAX_PARTICIPANTS — 1 通話あたりの最大 (実際に join した) 参加者数。
 *
 * docs/requirements.md SCALE-003 (Phase 2 グループ通話 最大50人) と
 * apps/server/src/routes/room-routes.ts の CreateRoomSchema.inviteeIds.max(49)
 * (host 1 名 + invitee 最大49名 = 50名) に合わせた技術的上限。
 *
 * Phase 1 の実運用は 1対1 のみだが (docs/requirements.md 「1対1 foreground音声通話」)、
 * バックエンドの participants テーブルは既に Phase 2 グループ通話向けに host + 最大49名の
 * invitee 事前登録を許容している。ROOM_FULL 判定はこの技術的上限を使うことで、
 * Phase 2 のグループ通話が実装された際もコード変更なしで動作する。
 */
export const ROOM_MAX_PARTICIPANTS = 50;
