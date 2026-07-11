// ⚠️ device-verification-required: このファイルは Xcode ビルド・実機/シミュレータ検証を
// 一度も行っていない。docs/native-call-bridge.md §4.2/§4.4/§4.6/§4.7 のコード片を元にした
// スキャフォールドであり、実際のコンパイル可否・CallKit 実機挙動は未検証。
//
// apps/mobile/ios/CallBridge/CallBridgeProvider.swift
//
// CXProvider の生成・設定 (§4.2)、CXProviderDelegate (§4.4)、終話送信 (§4.6)、
// AVAudioSession 協調 (§4.7) を担当する。modules/call-bridge/ios/CallBridgeModule.swift
// (Expo Module 薄いラッパー層) から呼び出される "OS API ラッパー" (§3.4)。
//
// import CallBridge: modules/call-bridge/ios/CallBridgeModule.swift は
// CocoaPods podspec (modules/call-bridge/ios/CallBridge.podspec, pod name "CallBridge") で
// 独立 framework としてビルドされる。app target (このファイル) → pod の import は許可されるが、
// 逆方向は循環依存になるため不可。そのため CallBridgeModule は `CallBridgeProviding`
// プロトコル越しにのみこのクラスを呼び出す (dependency inversion、CallBridgeModule.swift 冒頭コメント参照)。
import CallKit
import AVFAudio
import PushKit // PKPushRegistry (#68/#70: VoIP push 登録の実体)
import CallBridge
import ExpoModulesCore // Promise 型 (CallBridgeProviding プロトコルのシグネチャに必要)

struct TrackedCall {
  let uuid: UUID
  var state: String // CallStateSchema の値 ("ringing" | "answering" | "active" | ...)
  var roomId: String
}

/// CXProvider / PushKitDelegate を所有するアプリ内シングルトン。
/// CallBridgeModule (Expo Module) から `CallBridgeProviding` 経由で呼ばれる唯一の窓口。
final class CallBridgeProvider: NSObject, CallBridgeProviding {
  static let shared = CallBridgeProvider()

  let provider: CXProvider
  private var pushKitDelegate: PushKitDelegate?
  // #68/#70: PKPushRegistry の生成後、参照を保持しないと ARC により即座に解放され
  // (delegate 設定・desiredPushTypes 指定が無意味になり) VoIP push が一切受信できなくなる。
  // CallBridgeProvider.shared がアプリ生存期間中ずっと保持する。
  private var pushRegistry: PKPushRegistry?
  private var activeCalls: [UUID: TrackedCall] = [:]
  private let callController = CXCallController()

  private override init() {
    // §4.2 CXProvider configuration
    let config = CXProviderConfiguration()
    config.supportsVideo = false // Phase 1a は音声のみ
    config.maximumCallGroups = 1 // Phase 1a は同時 1 通話
    config.maximumCallsPerCallGroup = 1
    config.supportedHandleTypes = [.generic] // trancall_id を generic で扱う
    config.ringtoneSound = nil // OS 標準着信音を使用 (§14 リスク #8)
    config.includesCallsInRecents = true

    self.provider = CXProvider(configuration: config)
    super.init()
    self.provider.setDelegate(self, queue: nil)
  }

  /// `CallBridgeModule.providerDelegate` に自身を登録する。
  /// #68/#70: `plugins/with-ios-callbridge.js` の `withIosAppDelegateCallBridgeInit` mod が、
  /// expo prebuild で生成される ios/TranCall/AppDelegate.swift の
  /// `application(_:didFinishLaunchingWithOptions:)` 冒頭にこの呼び出しを自動注入する
  /// (手動配線不要。以前は「呼ぶ場所が無い」既知ギャップだったが解消済み)。
  func register() {
    CallBridgeModule.providerDelegate = self
  }

  // MARK: - PushKit registration entry point
  //
  // #68/#70: AppDelegate 起動時 (register() と同じタイミング) に呼ばれることを想定。
  // Apple の VoIP push は端末終了状態からもアプリを起こすため、JS の
  // `callBridge.registerForVoipPush()` 呼び出しを待たず、起動直後に無条件で
  // PKPushRegistry を生成し delegate 登録するのが正しい (JS からの呼び出しは
  // 冪等: 二重生成を防ぐため pushRegistry != nil なら何もしない)。

  /// §4.3: HMAC 共有鍵は expo-secure-store 経由でビルド時注入された値を使う想定
  /// (native-call-bridge.md §12.1)。ここでは placeholder として空文字を渡す
  /// ⚠️ device-verification-required: 実際の secret 取得ロジック未実装 (Keychain 読み出し等、Sprint 4 で対応)。
  func requestVoipPushRegistration() {
    if pushKitDelegate == nil {
      pushKitDelegate = PushKitDelegate(provider: provider, hmacSecret: fetchHmacSecretPlaceholder())
    }

    // #68/#70: PKPushRegistry(...) 自体をここで生成し delegate として登録する。
    // これが無いと PushKitDelegate (PKPushRegistryDelegate 実装) が一度も呼ばれず、
    // VoIP push を一切受信できない (以前は "生成コードがどこにもない" 既知ギャップだった)。
    if pushRegistry == nil {
      let registry = PKPushRegistry(queue: nil)
      registry.delegate = pushKitDelegate
      registry.desiredPushTypes = [.voIP]
      pushRegistry = registry
    }
  }

  private func fetchHmacSecretPlaceholder() -> String {
    // TODO(device-verification-required): expo-secure-store に書き込まれた
    // TRANCALL_PUSH_HMAC_SECRET を Keychain 経由で読み出す (Sprint 4)
    return ""
  }

  // MARK: - Outgoing call (§3.2.1)

  func startOutgoingCall(uuid: UUID, calleeName: String, roomId: String) {
    let handle = CXHandle(type: .generic, value: calleeName)
    let startCallAction = CXStartCallAction(call: uuid, handle: handle)
    startCallAction.isVideo = false
    let transaction = CXTransaction(action: startCallAction)

    callController.request(transaction) { [weak self] error in
      if let error = error {
        CallBridgeModule.emitCallEnded(uuid: uuid.uuidString, reason: "failed")
        NSLog("[CallBridgeProvider] startOutgoingCall failed: \(error)")
        return
      }
      self?.activeCalls[uuid] = TrackedCall(uuid: uuid, state: "answering", roomId: roomId)
    }
  }

  // MARK: - Incoming call reported directly from JS (debug path, §7.1 note)

  func reportIncomingCallFromJS(payload: [String: Any], promise: Promise) {
    guard
      let uuidString = payload["uuid"] as? String,
      let uuid = UUID(uuidString: uuidString),
      let callerTrancallId = payload["callerTrancallId"] as? String
    else {
      promise.reject(CallBridgeError.invalidArguments)
      return
    }

    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: callerTrancallId)
    update.localizedCallerName = payload["callerName"] as? String
    update.hasVideo = false

    provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
      if let error = error {
        NSLog("[CallBridgeProvider] reportNewIncomingCall (JS path) failed: \(error)")
        promise.reject(error)
        return
      }
      let roomId = (payload["roomId"] as? String) ?? ""
      self?.activeCalls[uuid] = TrackedCall(uuid: uuid, state: "ringing", roomId: roomId)
      promise.resolve(nil)
    }
  }

  // MARK: - Answer (§7.1 answerCall — 通常は CallKit UI 経由で自動発火するため fallback 用途)

  func answerCall(uuid: UUID) {
    let action = CXAnswerCallAction(call: uuid)
    callController.request(CXTransaction(action: action)) { error in
      if let error = error {
        NSLog("[CallBridgeProvider] answerCall failed: \(error)")
      }
    }
  }

  // MARK: - End call (§4.6)

  func endCall(uuid: UUID) {
    let action = CXEndCallAction(call: uuid)
    let transaction = CXTransaction(action: action)
    callController.request(transaction) { error in
      // 失敗時はログのみ。CallKit が provider state を整合 (§4.6)
      if let error = error {
        NSLog("[CallBridgeProvider] endCall failed: \(error)")
      }
    }
  }

  // MARK: - Mute / Speaker

  func setMuted(uuid: UUID, muted: Bool) {
    let action = CXSetMutedCallAction(call: uuid, muted: muted)
    callController.request(CXTransaction(action: action)) { error in
      if let error = error {
        NSLog("[CallBridgeProvider] setMuted failed: \(error)")
      }
    }
  }

  func setSpeakerphone(enabled: Bool) {
    // ⚠️ device-verification-required: overrideOutputAudioPort は CallKit didActivate 後の
    // audioSession に対して呼ぶ必要がある (実機でのタイミング未検証)。
    do {
      let session = AVAudioSession.sharedInstance()
      try session.overrideOutputAudioPort(enabled ? .speaker : .none)
    } catch {
      NSLog("[CallBridgeProvider] setSpeakerphone failed: \(error)")
    }
  }

  func getCurrentCallState() -> (uuid: UUID, state: String)? {
    guard let first = activeCalls.values.first else { return nil }
    return (first.uuid, first.state)
  }

  // MARK: - HMAC (#H-3, CallBridgeProviding 経由で JS の HmacValidator.ts から呼ばれる)

  func validateCallPayload(payload: [String: Any], secret: String) -> Bool {
    HmacValidator.validateCallPayload(payload: payload, secret: secret)
  }
}

// MARK: - CXProviderDelegate (§4.4)

extension CallBridgeProvider: CXProviderDelegate {
  func providerDidReset(_ provider: CXProvider) {
    // OS が provider 状態をリセット (アプリ更新等)。ongoing call を全て破棄
    activeCalls.removeAll()
  }

  func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    // startOutgoingCall の transaction が受理された時点で呼ばれる
    provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: nil)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    // ユーザーが応答ボタンを押した (CallKit UI 経由)
    // 実際の audio session activation は didActivate audioSession で行う (§4.4)
    activeCalls[action.callUUID]?.state = "answering"
    CallBridgeModule.emitCallAnswered(uuid: action.callUUID.uuidString)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    activeCalls.removeValue(forKey: action.callUUID)
    CallBridgeModule.emitCallEnded(uuid: action.callUUID.uuidString, reason: "user")
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    CallBridgeModule.emitCallMuted(uuid: action.callUUID.uuidString, muted: action.isMuted)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    // ★ CallKit が AudioSession を activate したタイミング (§4.4/§4.7) ★
    // allowBluetooth (HFP) はマイク入力に必須、allowBluetoothA2DP は出力品質向上用
    try? audioSession.setCategory(
      .playAndRecord,
      mode: .voiceChat,
      options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP]
    )
    try? audioSession.setPreferredSampleRate(48000) // LiveKit Opus 48kHz と整合

    if let uuid = activeCalls.keys.first {
      activeCalls[uuid]?.state = "active"
      CallBridgeModule.emitAudioRouteChanged(uuid: uuid.uuidString, route: "earpiece")
    }
    // JS 側 (src/lib/livekit/audio-session.ts) がこの didActivate 相当のタイミングを
    // 待ってから AudioSession.startAudioSession() を呼ぶ設計 (§4.7)。本 Swift 層は
    // audioRouteChanged event を emit するのみで、実際の LiveKit room.connect は JS が行う。
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    // 通話終了後、CallKit が AudioSession を deactivate (§4.4)
  }
}
