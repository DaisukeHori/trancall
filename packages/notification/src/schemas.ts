/**
 * @trancall/notification 内部スキーマ
 *
 * docs/notification-detail.md の payload 仕様を Zod で定義する。
 * Public API 型 (NotificationTarget, IncomingCallNotification) は shared-kernel
 * ではなくこのファイルで再定義し、内部バリデーションに使用する。
 */

import { z } from "zod";

import { RoomIdSchema, UserIdSchema } from "@trancall/shared-kernel";

// ---------------------------------------------------------------------------
// デバイストークン登録
// ---------------------------------------------------------------------------

export const NotificationTargetSchema = z.discriminatedUnion("platform", [
  z.object({
    platform: z.literal("ios"),
    voipToken: z.string().min(1),
    bundleId: z.string().min(1),
  }),
  z.object({
    platform: z.literal("android"),
    fcmToken: z.string().min(1),
  }),
]);
export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;

// ---------------------------------------------------------------------------
// 着信通知 payload (docs/notification-detail.md 厳守)
// ---------------------------------------------------------------------------

export const IncomingCallNotificationSchema = z.object({
  roomId: RoomIdSchema,
  callerName: z.string().min(1),
  callerAvatarUrl: z.string().url().nullable(),
  callerTrancallId: z.string().min(1),
  roomType: z.enum(["audio", "video"]),
  translationEnabled: z.boolean(),
  languagePair: z.string().min(1),
  callerLanguage: z.string().min(1),
  timestamp: z.string().datetime(),
});
export type IncomingCallNotification = z.infer<typeof IncomingCallNotificationSchema>;

// ---------------------------------------------------------------------------
// 不在着信通知 payload
// ---------------------------------------------------------------------------

export const MissedCallPayloadSchema = z.object({
  callerName: z.string().min(1),
  callerAvatarUrl: z.string().url().nullable(),
  roomId: RoomIdSchema,
  timestamp: z.string().datetime(),
});
export type MissedCallPayload = z.infer<typeof MissedCallPayloadSchema>;

// ---------------------------------------------------------------------------
// デバイストークン DB 行
// ---------------------------------------------------------------------------

export const DeviceTokenRowSchema = z.object({
  id: z.string().uuid(),
  userId: UserIdSchema,
  platform: z.enum(["ios", "android"]),
  token: z.string().min(1),
  bundleId: z.string().nullable(),
  isActive: z.boolean(),
  lastSeenAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type DeviceTokenRow = z.infer<typeof DeviceTokenRowSchema>;

// ---------------------------------------------------------------------------
// APNs iOS VoIP Push payload
// ---------------------------------------------------------------------------

export const ApnsVoipPayloadSchema = z.object({
  aps: z.object({}),
  trancall: z.object({
    type: z.literal("incoming_call"),
    roomId: z.string().uuid(),
    callerName: z.string(),
    callerAvatarUrl: z.string().nullable(),
    callerTrancallId: z.string(),
    roomType: z.enum(["audio", "video"]),
    translationEnabled: z.boolean(),
    languagePair: z.string(),
    callerLanguage: z.string(),
    timestamp: z.string().datetime(),
  }),
});
export type ApnsVoipPayload = z.infer<typeof ApnsVoipPayloadSchema>;

// ---------------------------------------------------------------------------
// FCM Android data payload
// ---------------------------------------------------------------------------

export const FcmDataPayloadSchema = z.object({
  type: z.enum(["incoming_call", "missed_call"]),
  roomId: z.string().uuid(),
  callerName: z.string(),
  callerAvatarUrl: z.string().nullable(),
  callerTrancallId: z.string().optional(),
  roomType: z.enum(["audio", "video"]).optional(),
  translationEnabled: z.string().optional(), // FCM data は文字列のみ
  languagePair: z.string().optional(),
  timestamp: z.string().datetime(),
});
export type FcmDataPayload = z.infer<typeof FcmDataPayloadSchema>;

// ---------------------------------------------------------------------------
// 配信ログ書き込み用
// ---------------------------------------------------------------------------

export const PushLogWriteSchema = z.object({
  userId: UserIdSchema,
  notificationType: z.enum(["incoming_call", "missed_call"]),
  roomId: RoomIdSchema.nullable(),
  delivered: z.boolean().nullable(),
  errorMessage: z.string().nullable(),
});
export type PushLogWrite = z.infer<typeof PushLogWriteSchema>;
