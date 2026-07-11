/**
 * @trancall/notification 内部スキーマ
 *
 * docs/notification-detail.md の payload 仕様を Zod で定義する。
 * Public API 型 (NotificationTarget, IncomingCallNotification) は shared-kernel
 * ではなくこのファイルで再定義し、内部バリデーションに使用する。
 */

import { z } from "zod";

import { RoomIdSchema, UserIdSchema, CallRoomTypeSchema } from "@trancall/shared-kernel";

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
  /** CallKit 用 UUID（小文字 hex、roomId とは独立） */
  uuid: z.uuid(),
  /** 発信者の内部ユーザー ID */
  callerId: z.string().min(1),
  callerName: z.string().min(1),
  callerAvatarUrl: z.url().nullable(),
  callerTrancallId: z.string().min(1),
  // L-9: roomType の値ドメインは packages/shared-kernel (native-call.ts) の
  // CallRoomTypeSchema を canonical 単一ソースとして参照する
  // (apps/mobile/modules/call-bridge の IncomingCallPushPayloadSchema と共有)。
  roomType: CallRoomTypeSchema,
  translationEnabled: z.boolean(),
  languagePair: z.string().min(1),
  callerLanguage: z.string().min(1),
  timestamp: z.iso.datetime(),
});
export type IncomingCallNotification = z.infer<typeof IncomingCallNotificationSchema>;

// ---------------------------------------------------------------------------
// 不在着信通知 payload
// ---------------------------------------------------------------------------

export const MissedCallPayloadSchema = z.object({
  callerName: z.string().min(1),
  callerTrancallId: z.string().min(1),
  callerAvatarUrl: z.url().nullable(),
  roomId: RoomIdSchema,
  timestamp: z.iso.datetime(),
});
export type MissedCallPayload = z.infer<typeof MissedCallPayloadSchema>;

// ---------------------------------------------------------------------------
// デバイストークン DB 行
// ---------------------------------------------------------------------------

export const DeviceTokenRowSchema = z.object({
  id: z.uuid(),
  userId: UserIdSchema,
  platform: z.enum(["ios", "android"]),
  token: z.string().min(1),
  bundleId: z.string().nullable(),
  isActive: z.boolean(),
  lastSeenAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type DeviceTokenRow = z.infer<typeof DeviceTokenRowSchema>;

// ---------------------------------------------------------------------------
// APNs iOS VoIP Push payload
// ---------------------------------------------------------------------------

export const ApnsVoipPayloadSchema = z.object({
  aps: z.object({}),
  trancall: z.object({
    type: z.literal("incoming_call"),
    /** CallKit 用 UUID（小文字 hex、roomId とは独立） */
    uuid: z.uuid(),
    roomId: z.uuid(),
    /** 発信者の内部ユーザー ID */
    callerId: z.string(),
    callerName: z.string(),
    callerAvatarUrl: z.string().nullable(),
    callerTrancallId: z.string(),
    roomType: CallRoomTypeSchema, // L-9: shared-kernel canonical
    translationEnabled: z.boolean(),
    languagePair: z.string(),
    callerLanguage: z.string(),
    timestamp: z.iso.datetime(),
    /** 発行時刻（ISO8601 .000Z 形式） */
    issuedAt: z.iso.datetime(),
    /** 有効期限（ISO8601 .000Z 形式、30 秒 TTL） */
    expiresAt: z.iso.datetime(),
    /** HMAC-SHA256 署名（小文字 hex 64 文字）— docs/notification-detail.md §3 */
    signature: z.string().regex(/^[0-9a-f]{64}$/, "HMAC-SHA256 hex 64 文字"),
  }),
});
export type ApnsVoipPayload = z.infer<typeof ApnsVoipPayloadSchema>;

// ---------------------------------------------------------------------------
// FCM Android data payload
// ---------------------------------------------------------------------------

export const FcmDataPayloadSchema = z.object({
  type: z.enum(["incoming_call", "missed_call"]),
  /** CallKit 用 UUID（FCM は string のみ） */
  uuid: z.string().optional(),
  roomId: z.uuid(),
  /** 発信者の内部ユーザー ID */
  callerId: z.string().optional(),
  callerName: z.string(),
  callerAvatarUrl: z.string().nullable(),
  callerTrancallId: z.string().optional(),
  roomType: CallRoomTypeSchema.optional(), // L-9: shared-kernel canonical
  translationEnabled: z.string().optional(), // FCM data は文字列のみ
  languagePair: z.string().optional(),
  callerLanguage: z.string().optional(),
  timestamp: z.iso.datetime(),
  /** 発行時刻（ISO8601 .000Z 形式、FCM は string） */
  issuedAt: z.string().optional(),
  /** 有効期限（ISO8601 .000Z 形式、30 秒 TTL、FCM は string） */
  expiresAt: z.string().optional(),
  /** HMAC-SHA256 署名（小文字 hex 64 文字）— docs/notification-detail.md §3 */
  signature: z.string().optional(),
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
