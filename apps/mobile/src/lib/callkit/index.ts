/**
 * react-native-callkeep wrapper — CallKit (iOS) / ConnectionService (Android)
 *
 * TypeScript 層のみ実装。
 * 実 native binding は expo prebuild + react-native-callkeep install 後に有効。
 *
 * iOS 側:
 *   - VoIP Push 受信 → reportNewIncomingCall (必ず即座に呼ぶ)
 *   - 応答 → answerCall
 *   - 拒否 → endCall
 *   - 通話終了 → endCall
 *
 * Android 側:
 *   - ConnectionService 経由で同等の操作
 */

export interface CallKitLabels {
  alertDescription: string;
  cancelButton: string;
  okButton: string;
}

export interface CallKeepConfig {
  appName: string;
  maximumCallsPerCallGroup?: number;
  includesCallsInRecents?: boolean;
  labels?: CallKitLabels;
}

export interface IncomingCallOptions {
  uuid: string;
  handle: string;
  callerName: string;
  hasVideo?: boolean;
}

export interface CallKeepHandle {
  configure: (config: CallKeepConfig) => void;
  displayIncomingCall: (opts: IncomingCallOptions) => void;
  answerIncomingCall: (uuid: string) => void;
  endCall: (uuid: string) => void;
  registerEvents: (handlers: CallKeepEventHandlers) => () => void;
}

export interface CallKeepEventHandlers {
  onAnswerCall?: (uuid: string) => void;
  onEndCall?: (uuid: string) => void;
  onIncomingCallDisplayed?: (uuid: string) => void;
  onDidReceiveStartCallAction?: (handle: string) => void;
}

export type RNCallKeepNativeModule = {
  setup?: (config: unknown) => void;
  displayIncomingCall?: (
    uuid: string,
    handle: string,
    name: string,
    handleType: string,
    hasVideo: boolean,
  ) => void;
  answerIncomingCall?: (uuid: string) => void;
  endCall?: (uuid: string) => void;
  addEventListener?: (
    event: string,
    handler: (data: Record<string, unknown>) => void,
  ) => { remove: () => void };
};

function makeNoOpCallKeep(): CallKeepHandle {
  return {
    configure: () => undefined,
    displayIncomingCall: () => undefined,
    answerIncomingCall: () => undefined,
    endCall: () => undefined,
    registerEvents: () => () => undefined,
  };
}

function buildCallKeep(RNCallKeep: RNCallKeepNativeModule): CallKeepHandle {
  return {
    configure: (config) => {
      RNCallKeep.setup?.({
        ios: {
          appName: config.appName,
          maximumCallsPerCallGroup: config.maximumCallsPerCallGroup ?? 1,
          includesCallsInRecents: config.includesCallsInRecents ?? true,
        },
        android: {
          alertTitle: config.appName,
          alertDescription: config.labels?.alertDescription ?? "Incoming call",
          cancelButton: config.labels?.cancelButton ?? "Decline",
          okButton: config.labels?.okButton ?? "Answer",
          additionalPermissions: [],
          selfManaged: false,
        },
      });
    },

    displayIncomingCall: (opts) => {
      RNCallKeep.displayIncomingCall?.(
        opts.uuid,
        opts.handle,
        opts.callerName,
        "generic",
        opts.hasVideo ?? false,
      );
    },

    answerIncomingCall: (uuid) => {
      RNCallKeep.answerIncomingCall?.(uuid);
    },

    endCall: (uuid) => {
      RNCallKeep.endCall?.(uuid);
    },

    registerEvents: (handlers) => {
      const listeners: Array<{ remove: () => void }> = [];

      if (RNCallKeep.addEventListener != null) {
        if (handlers.onAnswerCall != null) {
          const h = handlers.onAnswerCall;
          listeners.push(
            RNCallKeep.addEventListener("answerCall", (data) => {
              const callUUID = typeof data["callUUID"] === "string" ? data["callUUID"] : "";
              h(callUUID);
            }),
          );
        }

        if (handlers.onEndCall != null) {
          const h = handlers.onEndCall;
          listeners.push(
            RNCallKeep.addEventListener("endCall", (data) => {
              const callUUID = typeof data["callUUID"] === "string" ? data["callUUID"] : "";
              h(callUUID);
            }),
          );
        }

        if (handlers.onIncomingCallDisplayed != null) {
          const h = handlers.onIncomingCallDisplayed;
          listeners.push(
            RNCallKeep.addEventListener("didDisplayIncomingCall", (data) => {
              const callUUID = typeof data["callUUID"] === "string" ? data["callUUID"] : "";
              h(callUUID);
            }),
          );
        }

        if (handlers.onDidReceiveStartCallAction != null) {
          const h = handlers.onDidReceiveStartCallAction;
          listeners.push(
            RNCallKeep.addEventListener("didReceiveStartCallAction", (data) => {
              const handle = typeof data["handle"] === "string" ? data["handle"] : "";
              h(handle);
            }),
          );
        }
      }

      return () => {
        for (const listener of listeners) {
          listener.remove();
        }
      };
    },
  };
}

// Singleton override for testing — set this to inject a mock native module
// Usage in tests: setCallKeepNativeModule(mockModule)
let _nativeModuleOverride: RNCallKeepNativeModule | null = null;

export function setCallKeepNativeModule(mod: RNCallKeepNativeModule | null): void {
  _nativeModuleOverride = mod;
}

/**
 * CallKeep シングルトンを取得。
 * native module が存在しない場合は no-op 実装を返す。
 * テスト時は setCallKeepNativeModule() でモジュールを注入可能。
 */
export function getCallKeep(): CallKeepHandle {
  // Test injection takes priority
  if (_nativeModuleOverride != null) {
    return buildCallKeep(_nativeModuleOverride);
  }

  // Production: attempt to load native module
  let nativeModule: RNCallKeepNativeModule | null = null;
  try {
    const mod = require("react-native-callkeep") as { default?: RNCallKeepNativeModule } & RNCallKeepNativeModule; // eslint-disable-line @typescript-eslint/no-require-imports
    nativeModule = mod.default ?? mod;
  } catch {
    // native module not installed
    nativeModule = null;
  }

  if (nativeModule == null) {
    return makeNoOpCallKeep();
  }

  return buildCallKeep(nativeModule);
}
