/**
 * native-call.ts — ネイティブ通話ブリッジ (CallBridge) の canonical Zod schema (L-9, G-10 解消)
 *
 * canonical: docs/native-call-bridge.md §7.1 (公開 TypeScript インタフェース), §7.5 (Type 定義の単一ソース)
 *
 * 元々は `apps/mobile/modules/call-bridge/src/CallBridge.types.ts` にスコープ制約
 * (`apps/mobile` と `packages/ui-kit` のみ変更可) のため暫定配置されていたが、
 * `packages/shared-kernel` へ移設し canonical 単一ソース化した。
 * `apps/mobile/modules/call-bridge` (native module 側) はここから re-export する形で利用し、
 * `packages/notification` は wire フォーマットが同一の要素 (roomType の値ドメイン等) を
 * ここから参照する (両者で意図的に検証の厳しさが異なる箇所 — 例: uuid フォーマット厳格化・
 * branded RoomId・URL 検証は notification 側がサーバー送信前の厳格バリデーションとして
 * 個別に保持し、ここには持ち込まない)。
 */
import { z } from "zod";
import { OutputLanguage } from "./language.ts";

// --- Call state machine (§7.1, §8.1) ---

export const CallStateSchema = z.enum([
  "idle",
  "ringing", // 着信受信、ユーザー応答待ち
  "answering", // 応答ボタン押下後、room.connect 開始まで
  "connecting", // room.connect 中、participant_joined 待ち
  "active", // 通話中
  "ending", // endCall 実行中
  "ended",
]);
export type CallState = z.infer<typeof CallStateSchema>;

// --- Call room type (call-bridge と notification 双方の wire payload で共有する値ドメイン) ---

export const CallRoomTypeSchema = z.enum(["audio", "video"]);
export type CallRoomType = z.infer<typeof CallRoomTypeSchema>;

// --- Native → JS events (§7.1) ---

export const CallEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("incomingCall"),
    uuid: z.string().uuid(),
    callerId: z.string(),
    callerName: z.string(),
    callerTrancallId: z.string(),
    roomId: z.string(),
    sourceLang: OutputLanguage,
    targetLang: OutputLanguage,
  }),
  z.object({
    type: z.literal("callAnswered"),
    uuid: z.string().uuid(),
  }),
  z.object({
    type: z.literal("callEnded"),
    uuid: z.string().uuid(),
    reason: z.enum(["user", "remote", "timeout", "force_terminated", "failed"]),
  }),
  z.object({
    type: z.literal("callMuted"),
    uuid: z.string().uuid(),
    muted: z.boolean(),
  }),
  z.object({
    type: z.literal("audioRouteChanged"),
    uuid: z.string().uuid(),
    route: z.enum(["earpiece", "speaker", "bluetooth", "wired_headset"]),
  }),
  z.object({
    type: z.literal("deviceTokenUpdated"),
    token: z.string(),
    platform: z.enum(["ios", "android"]),
  }),
]);
export type CallEvent = z.infer<typeof CallEventSchema>;

// --- VoIP push payload (§6.1/§6.2/§6.3, canonical wire format = notification-detail.md) ---
//
// apps/mobile/src/lib/callkit/voip-push.ts の TrancallVoIPPushPayloadSchema と同一契約。
// CallBridge Module 経由の HMAC 検証 (validateCallPayload) を呼ぶための型としても使う。
// クライアント側の defense-in-depth parse のため、notification 側 (ApnsVoipPayloadSchema /
// FcmDataPayloadSchema) より意図的に寛容 (uuid/roomId は format 未検証の plain string 等) — サーバー側は
// 署名前に別途厳格なバリデーションを行うため、ここで重複して厳格化はしない。

export const IncomingCallPushPayloadSchema = z.object({
  type: z.literal("incoming_call"),
  uuid: z.string(),
  roomId: z.string(),
  callerId: z.string(),
  callerName: z.string(),
  callerAvatarUrl: z.string().nullable().optional(),
  callerTrancallId: z.string(),
  roomType: CallRoomTypeSchema,
  translationEnabled: z.boolean(),
  languagePair: z.string(),
  callerLanguage: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  signature: z.string(),
});
export type IncomingCallPushPayload = z.infer<typeof IncomingCallPushPayloadSchema>;
