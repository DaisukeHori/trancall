/**
 * VoIP Push 受信ハンドラ
 *
 * iOS: react-native-voip-push-notification
 * Android: FCM data message (High priority)
 *
 * VoIP Push 受信時に CallKit の displayIncomingCall を呼ぶ。
 * iOS: エンタイトルメント剥奪を防ぐため、受信後即座に呼ぶこと (docs/call-lifecycle.md Section 2)
 *
 * Payload wire format の canonical は docs/native-call-bridge.md §6.1 (iOS) / §6.2 (Android)。
 * 実体は `docs/notification-detail.md` §1-§3 が真。nested 構造 (`{ aps: {}, trancall: {...} }`)
 * で送られてくるため、`trancall` キー配下からフィールドを取得する。
 */
import { Platform } from "react-native";
import { getCallKeep } from "./index";
import { i18n } from "../../i18n/index";
import { z } from "zod";

// --- Payload schema (docs/native-call-bridge.md §6.1) ---

const TrancallVoIPPushPayloadSchema = z.object({
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

const VoIPPushPayloadSchema = z.object({
  aps: z.unknown().optional(),
  trancall: TrancallVoIPPushPayloadSchema,
});

export type VoIPPushPayload = z.infer<typeof TrancallVoIPPushPayloadSchema>;

export interface VoIPPushHandlers {
  onIncomingCall: (payload: VoIPPushPayload) => void;
}

/**
 * Apple 規約 (docs/native-call-bridge.md §9.1) 対応の簡易フォールバック UUID 生成。
 * 暗号学的な安全性は不要 (CallKit 上で即終話する無効 push の一時識別子としてのみ使用)。
 * `crypto.randomUUID` は RN Hermes 環境で保証されないため依存を増やさず自前実装する。
 */
function generateFallbackUuid(): string {
  const hex = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `${hex()}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-8${hex().slice(0, 3)}-${hex()}${hex().slice(0, 4)}`;
}

/**
 * raw notification payload (schema 不一致でも) から可能な限り uuid を抽出する。
 * CallKit の重複 UUID エラーを避けるため、既存の uuid があればそれを再利用する。
 */
function extractRawUuid(data: unknown): string | null {
  if (data === null || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;

  const trancall = record["trancall"];
  if (trancall !== null && typeof trancall === "object") {
    const nestedUuid = (trancall as Record<string, unknown>)["uuid"];
    if (typeof nestedUuid === "string" && nestedUuid.length > 0) return nestedUuid;
  }

  const topUuid = record["uuid"];
  if (typeof topUuid === "string" && topUuid.length > 0) return topUuid;

  return null;
}

type VoIPPushModule = {
  registerVoipToken?: () => void;
  addEventListener?: (event: string, handler: (n: unknown) => void) => void;
  removeEventListener?: (event: string) => void;
};

/**
 * iOS VoIP Push 受信リスナーを登録。
 * Returns an unsubscribe function.
 */
export function registerVoIPPushListeners(handlers: VoIPPushHandlers): () => void {
  if (Platform.OS === "ios") {
    return registerIOSVoIPPush(handlers);
  } else if (Platform.OS === "android") {
    // Android は expo-notifications の setNotificationHandler + addNotificationResponseReceivedListener
    // FCM High priority data message で着信通知を受信する
    // 詳細実装は Phase 2 (notification module との結合)
    return registerAndroidFCMPush(handlers);
  }
  return () => undefined;
}

function loadVoIPPushModule(): VoIPPushModule | null {
  try {
    const mod = require("react-native-voip-push-notification") as { default?: VoIPPushModule } & VoIPPushModule; // eslint-disable-line @typescript-eslint/no-require-imports
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

function registerIOSVoIPPush(handlers: VoIPPushHandlers): () => void {
  const voipPush = loadVoIPPushModule();
  if (voipPush == null) return () => undefined;

  const callKeep = getCallKeep();

  // Register for VoIP push
  voipPush.registerVoipToken?.();

  const handleIncoming = (notification: unknown) => {
    if (notification === null || typeof notification !== "object") return;
    const n = notification as Record<string, unknown>;
    const data = n["data"] ?? n;
    const parsed = VoIPPushPayloadSchema.safeParse(data);

    if (!parsed.success) {
      // docs/native-call-bridge.md §9.1: iOS 13+ は pushRegistry の
      // didReceiveIncomingPushWith 内で必ず reportNewIncomingCall (+ completion) を
      // 呼ばないと、以降の VoIP push 受信権限がアプリから剥奪される。
      // payload が canonical wire format と不一致な場合でも、schema 検証失敗を理由に
      // 何も表示せず終わることは規約違反になるため、フォールバック着信表示 + 即終話で対応する
      // (HMAC 署名不一致時の "log only で破棄" (§12.1) とは別ケース: あちらは正しい構造の
      // payload の真正性検証、こちらは構造自体が壊れている場合の OS 制約遵守)。
      const fallbackUuid = extractRawUuid(data) ?? generateFallbackUuid();
      const unknownCaller = i18n.t("common.unknown");
      callKeep.displayIncomingCall({
        uuid: fallbackUuid,
        handle: unknownCaller,
        callerName: unknownCaller,
        hasVideo: false,
      });
      callKeep.endCall(fallbackUuid);
      return;
    }

    const payload = parsed.data.trancall;

    // iOS: CallKit displayIncomingCall は即座に呼ぶ必要がある
    callKeep.displayIncomingCall({
      uuid: payload.uuid,
      handle: payload.callerTrancallId,
      callerName: payload.callerName,
      hasVideo: payload.roomType === "video",
    });

    handlers.onIncomingCall(payload);
  };

  voipPush.addEventListener?.("register", () => undefined);
  voipPush.addEventListener?.("didReceiveIncomingPush", handleIncoming);

  return () => {
    voipPush.removeEventListener?.("didReceiveIncomingPush");
  };
}

function registerAndroidFCMPush(handlers: VoIPPushHandlers): () => void {
  // Android は expo-notifications の setNotificationHandler + addNotificationResponseReceivedListener
  // FCM High priority data message で着信通知を受信する
  // 詳細実装は Phase 2 (notification module との結合)
  void handlers;
  return () => undefined;
}
