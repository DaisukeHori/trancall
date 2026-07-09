// ⚠️ device-verification-required: このファイルは Xcode ビルド・実機/シミュレータ検証を
// 一度も行っていない。Swift の構文・API 呼び出しは docs/native-call-bridge.md §4/§7.1 と
// 既存 Expo Module (expo-audio/expo-notifications) の実装パターンを参考に作成したスキャフォールドであり、
// 実際のコンパイル可否は未検証。
//
// modules/call-bridge/ios/CallBridgeModule.swift
//
// CallBridge Expo Module — JS ⇄ Native の薄いブリッジ層 (§3.4)。
// OS API (CXProvider/PushKit) の実操作は apps/mobile/ios/CallBridge/CallBridgeProvider.swift /
// PushKitDelegate.swift が担う (§3.4 "Native (Swift/Kotlin): OS API ラッパー")。
//
// アーキテクチャ上の注意 (CocoaPods 依存方向):
//   この Module は独立した CocoaPod ("CallBridge", modules/call-bridge/ios/CallBridge.podspec)
//   としてビルドされる。app target 側の CallBridgeProvider.swift は `import CallBridge` で
//   このファイルの public API を参照できるが、逆方向 (pod → app target) の import は
//   CocoaPods の依存グラフ上不可能 (循環依存になるため)。
//   そのため JS → Native の実処理委譲は `CallBridgeProviding` プロトコル経由の
//   dependency inversion で行う: app 側の CallBridgeProvider がこのプロトコルに準拠し、
//   自身を `CallBridgeModule.providerDelegate` に登録する。
//
// canonical: docs/native-call-bridge.md §7.1 (CallBridge JS API), §4 (iOS CallKit/PushKit)

import ExpoModulesCore

/// Native (CallBridgeProvider / PushKitDelegate) → JS への event 配信に使う単一 event 名。
/// payload の判別は JS 側の CallEventSchema (discriminatedUnion "type") が担う (§7.1)。
let onCallBridgeEvent = "onCallBridgeEvent"

/// app target 側の CallBridgeProvider が実装すべきプロトコル。
/// pod (このファイル) は具体クラスを知らず、このプロトコル越しにのみ処理を委譲する。
public protocol CallBridgeProviding: AnyObject {
  func requestVoipPushRegistration()
  func startOutgoingCall(uuid: UUID, calleeName: String, roomId: String)
  func reportIncomingCallFromJS(payload: [String: Any], promise: Promise)
  func answerCall(uuid: UUID)
  func endCall(uuid: UUID)
  func setMuted(uuid: UUID, muted: Bool)
  func setSpeakerphone(enabled: Bool)
  func getCurrentCallState() -> (uuid: UUID, state: String)?
  /// #H-3: apps/mobile/src/native/HmacValidator.ts から呼ばれる JS 側 defense-in-depth 検証。
  /// 実際の権威ある検証は native 側 (PushKitDelegate/FcmService) が push 受信時に同期実施済み。
  func validateCallPayload(payload: [String: Any], secret: String) -> Bool
}

public class CallBridgeModule: Module {
  /// CallBridgeProvider (app target 側) が起動時に自身を登録する。
  /// ⚠️ device-verification-required: 現状どこからも `providerDelegate = CallBridgeProvider.shared`
  /// の登録呼び出しが行われていない (AppDelegate.swift は expo prebuild で生成されるため
  /// 本リポジトリに実体が無い)。実機ビルド時に AppDelegate の didFinishLaunchingWithOptions 等で
  /// `CallBridgeProvider.shared.register()` を呼ぶ配線が別途必要 (Sprint 4)。
  public static weak var providerDelegate: CallBridgeProviding?

  /// event 配信用の shared 参照 (JS への sendEvent はこの Module インスタンス経由でのみ可能)。
  public static weak var shared: CallBridgeModule?

  public func definition() -> ModuleDefinition {
    Name("TranCallBridge")

    Events([onCallBridgeEvent])

    OnCreate {
      CallBridgeModule.shared = self
    }

    OnDestroy {
      if CallBridgeModule.shared === self {
        CallBridgeModule.shared = nil
      }
    }

    AsyncFunction("registerForVoipPush") { (promise: Promise) in
      guard let delegate = CallBridgeModule.providerDelegate else {
        promise.reject(CallBridgeError.providerNotRegistered)
        return
      }
      // ⚠️ device-verification-required: 実際の deviceToken は非同期に
      // PKPushRegistryDelegate.didUpdate → CallBridgeModule.emitDeviceToken 経由で通知される (§4.3)。
      // ここでは "登録要求を受け付けた" ことのみ resolve する (token は空文字の placeholder)。
      delegate.requestVoipPushRegistration()
      promise.resolve(["token": "", "platform": "ios"])
    }

    AsyncFunction("startOutgoingCall") { (args: [String: Any], promise: Promise) in
      guard let delegate = CallBridgeModule.providerDelegate else {
        promise.reject(CallBridgeError.providerNotRegistered)
        return
      }
      guard
        let uuidString = args["uuid"] as? String,
        let uuid = UUID(uuidString: uuidString),
        let calleeName = args["calleeName"] as? String,
        let roomId = args["roomId"] as? String
      else {
        promise.reject(CallBridgeError.invalidArguments)
        return
      }
      delegate.startOutgoingCall(uuid: uuid, calleeName: calleeName, roomId: roomId)
      promise.resolve(nil)
    }

    AsyncFunction("reportIncomingCall") { (payload: [String: Any], promise: Promise) in
      // Phase 1a note (§7.1): PushKitDelegate が自動的に処理するため、JS からの明示呼び出しは
      // 通常不要。テスト/デバッグ用の経路として残す。
      guard let delegate = CallBridgeModule.providerDelegate else {
        promise.reject(CallBridgeError.providerNotRegistered)
        return
      }
      delegate.reportIncomingCallFromJS(payload: payload, promise: promise)
    }

    AsyncFunction("answerCall") { (uuidString: String, promise: Promise) in
      guard let delegate = CallBridgeModule.providerDelegate else {
        promise.reject(CallBridgeError.providerNotRegistered)
        return
      }
      guard let uuid = UUID(uuidString: uuidString) else {
        promise.reject(CallBridgeError.invalidArguments)
        return
      }
      delegate.answerCall(uuid: uuid)
      promise.resolve(nil)
    }

    AsyncFunction("endCall") { (uuidString: String, promise: Promise) in
      guard let delegate = CallBridgeModule.providerDelegate else {
        promise.reject(CallBridgeError.providerNotRegistered)
        return
      }
      guard let uuid = UUID(uuidString: uuidString) else {
        promise.reject(CallBridgeError.invalidArguments)
        return
      }
      delegate.endCall(uuid: uuid)
      promise.resolve(nil)
    }

    AsyncFunction("setMuted") { (uuidString: String, muted: Bool, promise: Promise) in
      guard let delegate = CallBridgeModule.providerDelegate else {
        promise.reject(CallBridgeError.providerNotRegistered)
        return
      }
      guard let uuid = UUID(uuidString: uuidString) else {
        promise.reject(CallBridgeError.invalidArguments)
        return
      }
      delegate.setMuted(uuid: uuid, muted: muted)
      promise.resolve(nil)
    }

    AsyncFunction("setSpeakerphone") { (enabled: Bool, promise: Promise) in
      guard let delegate = CallBridgeModule.providerDelegate else {
        promise.reject(CallBridgeError.providerNotRegistered)
        return
      }
      delegate.setSpeakerphone(enabled: enabled)
      promise.resolve(nil)
    }

    AsyncFunction("getCurrentCallState") { (promise: Promise) in
      guard let delegate = CallBridgeModule.providerDelegate else {
        promise.resolve(nil)
        return
      }
      if let state = delegate.getCurrentCallState() {
        promise.resolve(["uuid": state.uuid.uuidString, "state": state.state])
      } else {
        promise.resolve(nil)
      }
    }

    // #H-3: HmacValidator.ts の JS 側 defense-in-depth 検証 (native-call-bridge.md §12.1)
    AsyncFunction("validateCallPayload") { (payload: [String: Any], secret: String, promise: Promise) in
      guard let delegate = CallBridgeModule.providerDelegate else {
        promise.resolve(false)
        return
      }
      promise.resolve(delegate.validateCallPayload(payload: payload, secret: secret))
    }
  }

  // MARK: - Static emit helpers (§4.3/§4.4 のコード片が呼び出す想定の API)
  //
  // apps/mobile/ios/CallBridge/CallBridgeProvider.swift / PushKitDelegate.swift から
  // `CallBridgeModule.emitXxx(...)` の形で呼ばれる (app target → pod の呼び出し、
  // これは CocoaPods 依存方向として正当)。`shared` が nil (Module 未初期化・
  // テスト環境等) の場合は何もしない (silent no-op)。

  public static func emitDeviceToken(token: String, platform: String) {
    shared?.sendEvent(onCallBridgeEvent, [
      "type": "deviceTokenUpdated",
      "token": token,
      "platform": platform,
    ])
  }

  public static func emitIncomingCall(
    uuid: String,
    callerId: String,
    callerName: String,
    callerTrancallId: String,
    roomId: String,
    sourceLang: String,
    targetLang: String
  ) {
    shared?.sendEvent(onCallBridgeEvent, [
      "type": "incomingCall",
      "uuid": uuid,
      "callerId": callerId,
      "callerName": callerName,
      "callerTrancallId": callerTrancallId,
      "roomId": roomId,
      "sourceLang": sourceLang,
      "targetLang": targetLang,
    ])
  }

  public static func emitCallAnswered(uuid: String) {
    shared?.sendEvent(onCallBridgeEvent, ["type": "callAnswered", "uuid": uuid])
  }

  public static func emitCallEnded(uuid: String, reason: String) {
    shared?.sendEvent(onCallBridgeEvent, ["type": "callEnded", "uuid": uuid, "reason": reason])
  }

  public static func emitCallMuted(uuid: String, muted: Bool) {
    shared?.sendEvent(onCallBridgeEvent, ["type": "callMuted", "uuid": uuid, "muted": muted])
  }

  public static func emitAudioRouteChanged(uuid: String, route: String) {
    shared?.sendEvent(onCallBridgeEvent, ["type": "audioRouteChanged", "uuid": uuid, "route": route])
  }
}

public enum CallBridgeError: Error {
  case invalidArguments
  case providerNotRegistered
}
