/**
 * VoIP Push 受信ハンドラ
 *
 * iOS: react-native-voip-push-notification
 * Android: FCM data message (High priority)
 *
 * VoIP Push 受信時に CallKit の displayIncomingCall を呼ぶ。
 * iOS: エンタイトルメント剥奪を防ぐため、受信後即座に呼ぶこと (docs/call-lifecycle.md Section 2)
 */
import { Platform } from "react-native";
import { getCallKeep } from "./index.js";
import { z } from "zod";

// --- Payload schema ---

const VoIPPushPayloadSchema = z.object({
  uuid: z.string(),
  callerName: z.string(),
  callerHandle: z.string().optional(),
  roomId: z.string(),
  translationEnabled: z.boolean().optional(),
  callerLanguage: z.string().optional(),
});

export type VoIPPushPayload = z.infer<typeof VoIPPushPayloadSchema>;

export interface VoIPPushHandlers {
  onIncomingCall: (payload: VoIPPushPayload) => void;
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
    if (!parsed.success) return;

    const payload = parsed.data;

    // iOS: CallKit displayIncomingCall は即座に呼ぶ必要がある
    callKeep.displayIncomingCall({
      uuid: payload.uuid,
      handle: payload.callerHandle ?? payload.callerName,
      callerName: payload.callerName,
      hasVideo: false,
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
