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

export const ParticipantSchema = z.object({
  id: ParticipantIdSchema,
  userId: UserIdSchema,
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
  createdBy: UserIdSchema,
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
  created_by: z.uuid(),
  created_at: z.iso.datetime(),
  ended_at: z.iso.datetime().nullable(),
});
export type RoomRow = z.infer<typeof RoomRowSchema>;

export const ParticipantRowSchema = z.object({
  id: z.uuid(),
  room_id: z.uuid(),
  user_id: z.uuid(),
  role: ParticipantRoleSchema,
  is_muted: z.boolean(),
  joined_at: z.iso.datetime(),
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
  joinedAt: z.iso.datetime(),
});
export type UpsertParticipantCommand = z.infer<typeof UpsertParticipantCommandSchema>;
