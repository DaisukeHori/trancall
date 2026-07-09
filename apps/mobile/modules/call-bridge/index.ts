/**
 * modules/call-bridge/index.ts — CallBridge Expo Module 公開 TypeScript API
 *
 * canonical: docs/native-call-bridge.md §7.1〜§7.4
 *
 * §3.4 単一責任の境界:
 *   - Native (Swift/Kotlin): OS API ラッパー (apps/mobile/ios/CallBridge/*.swift,
 *     apps/mobile/android/.../*.kt) — CXProvider/ConnectionService の直接操作
 *   - JS Bridge (このファイル): Native 関数呼出と event subscribe の薄いラッパ + Zod 検証
 *   - JS ビジネスロジック (CallStore): call state 管理、LiveKit Room との連携
 *
 * 禁止事項 (§3.4): Native 層に business logic を書かない、
 * JS から `NativeModules.TranCallBridge...` に直接アクセスしない (必ずこの層経由)。
 *
 * ⚠️ device-verification-required: `requireOptionalNativeModule("TranCallBridge")` は
 * iOS/Android のネイティブ実装 (ios/CallBridgeModule.swift, android/.../CallBridgeModule.kt) が
 * Expo prebuild + 実機/シミュレータビルドでリンクされて初めて解決する。本リポジトリでは
 * Xcode/Android Studio ビルドが実行できないため、`callBridge` の呼び出しは
 * 型チェックのみ検証済みで実機未検証 (native module 未リンク時は no-op フォールバック)。
 */
import { NativeModule, requireOptionalNativeModule } from "expo-modules-core";
import {
  CallEventSchema,
  IncomingCallPushPayloadSchema,
  type CallEvent,
  type CallState,
  type IncomingCallPushPayload,
} from "./src/CallBridge.types.js";

export {
  CallStateSchema,
  CallEventSchema,
  IncomingCallPushPayloadSchema,
} from "./src/CallBridge.types.js";
export type {
  CallState,
  CallEvent,
  IncomingCallPushPayload,
  CallBridgeError,
  CallBridgeErrorCode,
} from "./src/CallBridge.types.js";

/** Native module が emit する単一 event 名。payload は CallEventSchema で判別する。 */
type TranCallBridgeEventsMap = Record<"onCallBridgeEvent", (event: unknown) => void>;

/**
 * Native module が実装すべき関数シグネチャ (§7.1)。
 * `NativeModule` を継承しているため `.addListener` 等の EventEmitter API も利用できる。
 */
declare class TranCallBridgeNativeModule extends NativeModule<TranCallBridgeEventsMap> {
  registerForVoipPush(): Promise<{ token: string; platform: "ios" | "android" }>;
  startOutgoingCall(args: { uuid: string; calleeName: string; roomId: string }): Promise<void>;
  reportIncomingCall(payload: IncomingCallPushPayload): Promise<void>;
  answerCall(uuid: string): Promise<void>;
  endCall(uuid: string): Promise<void>;
  setMuted(uuid: string, muted: boolean): Promise<void>;
  setSpeakerphone(enabled: boolean): Promise<void>;
  getCurrentCallState(): Promise<{ uuid: string; state: CallState } | null>;
  /** #H-3: HmacValidator.ts の JS 側 defense-in-depth 検証用 */
  validateCallPayload(payload: Record<string, unknown>, secret: string): Promise<boolean>;
}

export interface CallBridge {
  registerForVoipPush(): Promise<{ token: string; platform: "ios" | "android" }>;
  startOutgoingCall(args: { uuid: string; calleeName: string; roomId: string }): Promise<void>;
  reportIncomingCall(payload: IncomingCallPushPayload): Promise<void>;
  answerCall(uuid: string): Promise<void>;
  endCall(uuid: string): Promise<void>;
  setMuted(uuid: string, muted: boolean): Promise<void>;
  setSpeakerphone(enabled: boolean): Promise<void>;
  getCurrentCallState(): Promise<{ uuid: string; state: CallState } | null>;
  validateCallPayload(payload: Record<string, unknown>, secret: string): Promise<boolean>;
  on<T extends CallEvent["type"]>(
    eventType: T,
    handler: (event: Extract<CallEvent, { type: T }>) => void,
  ): () => void;
}

let cachedNativeModule: TranCallBridgeNativeModule | null | undefined;

function resolveNativeModule(): TranCallBridgeNativeModule | null {
  if (cachedNativeModule === undefined) {
    cachedNativeModule = requireOptionalNativeModule<TranCallBridgeNativeModule>("TranCallBridge");
    if (cachedNativeModule == null) {
      console.warn(
        "[CallBridge] TranCallBridge native module is not linked (Expo Go, or native build " +
          "not performed for this SDK54 upgrade). Falling back to no-op. device-verification-required.",
      );
    }
  }
  return cachedNativeModule;
}

const NOT_LINKED_ERROR = {
  code: "CALL_BRIDGE_NATIVE_MODULE_UNAVAILABLE" as const,
  message:
    "TranCallBridge native module is not linked. Run `expo prebuild` and a native build " +
    "(device-verification-required, not possible in this environment).",
};

function rejectNotLinked(): Promise<never> {
  return Promise.reject(NOT_LINKED_ERROR);
}

export const callBridge: CallBridge = {
  registerForVoipPush: async () => {
    const native = resolveNativeModule();
    if (native == null) return rejectNotLinked();
    return native.registerForVoipPush();
  },

  startOutgoingCall: async (args) => {
    const native = resolveNativeModule();
    if (native == null) return rejectNotLinked();
    return native.startOutgoingCall(args);
  },

  reportIncomingCall: async (payload) => {
    const parsed = IncomingCallPushPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return Promise.reject({
        code: "CALL_BRIDGE_CALL_NOT_FOUND",
        message: `Invalid IncomingCallPushPayload: ${parsed.error.message}`,
      });
    }
    const native = resolveNativeModule();
    if (native == null) return rejectNotLinked();
    return native.reportIncomingCall(parsed.data);
  },

  answerCall: async (uuid) => {
    const native = resolveNativeModule();
    if (native == null) return rejectNotLinked();
    return native.answerCall(uuid);
  },

  endCall: async (uuid) => {
    const native = resolveNativeModule();
    if (native == null) return rejectNotLinked();
    return native.endCall(uuid);
  },

  setMuted: async (uuid, muted) => {
    const native = resolveNativeModule();
    if (native == null) return rejectNotLinked();
    return native.setMuted(uuid, muted);
  },

  setSpeakerphone: async (enabled) => {
    const native = resolveNativeModule();
    if (native == null) return rejectNotLinked();
    return native.setSpeakerphone(enabled);
  },

  getCurrentCallState: async () => {
    const native = resolveNativeModule();
    if (native == null) return null;
    return native.getCurrentCallState();
  },

  validateCallPayload: async (payload, secret) => {
    const native = resolveNativeModule();
    if (native == null) return false;
    return native.validateCallPayload(payload, secret);
  },

  /**
   * §7.3: 全 event payload を Zod safeParse してから呼び出し側に渡す
   * (失敗時は log のみ、呼び出し側ハンドラは呼ばない)。
   */
  on: (eventType, handler) => {
    const native = resolveNativeModule();
    if (native == null) {
      return () => undefined;
    }

    const subscription = native.addListener("onCallBridgeEvent", (raw: unknown) => {
      const parsed = CallEventSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn("[CallBridge] event payload failed Zod validation", parsed.error.issues);
        return;
      }
      if (parsed.data.type !== eventType) return;
      handler(parsed.data as Extract<CallEvent, { type: typeof eventType }>);
    });

    return () => {
      subscription.remove();
    };
  },
};
