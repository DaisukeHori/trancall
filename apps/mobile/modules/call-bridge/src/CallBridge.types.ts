/**
 * CallBridge.types.ts — CallBridge Expo Module の TS 型 / Zod schema
 *
 * canonical: docs/native-call-bridge.md §7.1 (公開 TypeScript インタフェース)
 *
 * §7.5 (Type 定義の単一ソース) は本来 `packages/shared-kernel/src/schemas/native-call.ts`
 * への配置が canonical だが、本タスクのスコープ制約 (apps/mobile と packages/ui-kit のみ変更可、
 * 他 packages は不可) により、暫定的に本モジュール内に配置する。
 * ⚠️ フォローアップ: スコープ制約が解除され次第、`packages/shared-kernel` へ移設し、
 * `apps/mobile` と `packages/notification` の双方から import する構成に揃えること
 * (native-call-bridge.md §7.5 / §6.3 参照)。
 */
import { z } from "zod";
import { OutputLanguage } from "@trancall/shared-kernel";

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
// lib/callkit/voip-push.ts の TrancallVoIPPushPayloadSchema と同一契約。
// #H-3: 新 CallBridge Module 経由で HMAC 検証 (validateCallPayload) を呼ぶための型として再定義する
// (voip-push.ts 側の schema を import すると lib/callkit → modules/call-bridge の逆方向依存になり
// §3.4 の単一責任境界に反するため、Module 側は独立した定義を持つ)。

export const IncomingCallPushPayloadSchema = z.object({
  type: z.literal("incoming_call"),
  uuid: z.string(),
  roomId: z.string(),
  callerId: z.string(),
  callerName: z.string(),
  callerAvatarUrl: z.string().nullable().optional(),
  callerTrancallId: z.string(),
  roomType: z.enum(["audio", "video"]),
  translationEnabled: z.boolean(),
  languagePair: z.string(),
  callerLanguage: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  signature: z.string(),
});
export type IncomingCallPushPayload = z.infer<typeof IncomingCallPushPayloadSchema>;

// --- CallBridge JS API errors (§7.2) ---

export type CallBridgeErrorCode =
  | "CALL_BRIDGE_AUDIO_SESSION_FAILED"
  | "CALL_BRIDGE_CALL_NOT_FOUND"
  | "CALL_BRIDGE_BUSY"
  | "CALL_BRIDGE_NATIVE_MODULE_UNAVAILABLE";

export interface CallBridgeError {
  code: CallBridgeErrorCode;
  message: string;
}
