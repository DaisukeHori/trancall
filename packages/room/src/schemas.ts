/**
 * @trancall/room — Zod スキーマ定義
 *
 * RoomState / Participant などの値の契約を Zod で定義する。
 * DB schema: trancall_room.rooms / trancall_room.participants
 */

import { z } from "zod";
import { RoomIdSchema, UserIdSchema, ParticipantIdSchema } from "@trancall/shared-kernel";

// ---------------------------------------------------------------------------
// Room ステータス
// ---------------------------------------------------------------------------

export const RoomStatusSchema = z.enum(["waiting", "active", "ended"]);
export type RoomStatus = z.infer<typeof RoomStatusSchema>;

// ---------------------------------------------------------------------------
// Participant
// ---------------------------------------------------------------------------

export const ParticipantRoleSchema = z.enum(["host", "member"]);
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

// 確定#2: joined_at が null の行は「招待済みだがまだ join していない」参加者を表す
// (createCall が host + invitee を事前登録する)。buildRoomState は joined_at !== null の
// 行のみを公開 RoomState.participants に含めるため、公開契約側の joinedAt は
// 常に non-null のまま維持できる (ここで nullable にしているのは DB 行の内部表現のみ)。
export const ParticipantSchema = z.object({
  id: ParticipantIdSchema,
  // nullable 追従 (00019 migration): 退会ユーザーが物理削除されると participants.user_id が
  // NULL 化される (行自体は保持)。null は「退会済みユーザー参照」を意味する。
  userId: UserIdSchema.nullable(),
  role: ParticipantRoleSchema,
  isMuted: z.boolean(),
  joinedAt: z.iso.datetime(),
  leftAt: z.iso.datetime().nullable(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

// ---------------------------------------------------------------------------
// RoomState — facade の返り値
// ---------------------------------------------------------------------------

export const RoomStateSchema = z.object({
  roomId: RoomIdSchema,
  status: RoomStatusSchema,
  translationEnabled: z.boolean(),
  // nullable 追従 (00019 migration): 作成者が退会し物理削除された場合 rooms.created_by が
  // NULL 化される。null は「退会済みユーザー参照」を意味する。
  createdBy: UserIdSchema.nullable(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  participants: z.array(ParticipantSchema),
});
export type RoomState = z.infer<typeof RoomStateSchema>;

// ---------------------------------------------------------------------------
// DB 行型 — Repository が返す raw 形式
// ---------------------------------------------------------------------------

export const RoomRowSchema = z.object({
  room_id: z.uuid(),
  status: RoomStatusSchema,
  room_type: z.enum(["audio", "video"]),
  translation_enabled: z.boolean(),
  // nullable 追従 (00019 migration): 退会済みユーザー参照は NULL 化される
  created_by: z.uuid().nullable(),
  created_at: z.iso.datetime(),
  ended_at: z.iso.datetime().nullable(),
});
export type RoomRow = z.infer<typeof RoomRowSchema>;

export const ParticipantRowSchema = z.object({
  id: z.uuid(),
  room_id: z.uuid(),
  // nullable 追従 (00019 migration): 退会済みユーザー参照は NULL 化される
  user_id: z.uuid().nullable(),
  role: ParticipantRoleSchema,
  is_muted: z.boolean(),
  // 確定#2: NULL は「招待済みだがまだ join していない」ことを表す
  // (supabase/migrations/00022_room_participants_invited_state.sql)
  joined_at: z.iso.datetime().nullable(),
  left_at: z.iso.datetime().nullable(),
});
export type ParticipantRow = z.infer<typeof ParticipantRowSchema>;

// ---------------------------------------------------------------------------
// InsertRoom / UpsertParticipant コマンド型
// ---------------------------------------------------------------------------

export const InsertRoomCommandSchema = z.object({
  roomId: RoomIdSchema,
  status: RoomStatusSchema,
  translationEnabled: z.boolean(),
  createdBy: UserIdSchema,
  createdAt: z.iso.datetime(),
});
export type InsertRoomCommand = z.infer<typeof InsertRoomCommandSchema>;

export const UpsertParticipantCommandSchema = z.object({
  roomId: RoomIdSchema,
  userId: UserIdSchema,
  role: ParticipantRoleSchema,
  // 確定#2: createCall が invitee を「招待済み・未参加」として事前登録する際は
  // joinedAt: null を渡す (実際に join した時点で markJoined が timestamp を設定する)。
  joinedAt: z.iso.datetime().nullable(),
});
export type UpsertParticipantCommand = z.infer<typeof UpsertParticipantCommandSchema>;
