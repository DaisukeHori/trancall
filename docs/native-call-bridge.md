# TranCall ネイティブ通話 Bridge 設計書 (Native Call Bridge Design)

| 項目 | 内容 |
|------|------|
| ドキュメント ID | NATIVE-CALL-001 |
| Status | Draft v1.4 (2026-05-12) |
| Sprint | Sprint 2 D4 |
| 上位文書 | `docs/architecture.md` (システム全体構成、canonical) / `docs/call-lifecycle.md` (シーケンス、canonical) / `docs/module-contracts.md` v1.1.0 (モジュール契約、canonical) / `docs/notification-detail.md` v1.3 (Push payload・HMAC、canonical) |
| 関連文書 | `docs/security-detail.md` (HMAC / 署名、canonical) / `docs/deployment-render-dryrun.md` (デプロイ手順) |
| 下位実装対象 | `apps/mobile/` 内に Expo Module を配置、Sprint 3 (Phase 1a 実装フェーズ) で着手予定 |
| 想定読者 | Sprint 3 で `apps/mobile/` の native module を実装する engineer、レビュー時に CallKit / ConnectionService の正しさを判断する reviewer |

---

## 目次

1. スコープと位置付け
2. 用語と前提
3. 全体アーキテクチャ
4. iOS CallKit + PushKit 設計
5. Android Telecom + ConnectionService 設計
6. VoIP Push 設計
7. React Native Native Module 仕様 (CallBridge JS API)
8. 状態遷移と source of truth
9. 失敗ケースと OS 固有制約
10. Phase 1a スコープ vs Phase 1b 以降 (deferred)
11. テスト戦略
12. セキュリティ
13. 実装移行手順 (Sprint 3 着手時)
14. 既知のリスク
15. 改訂履歴

---

## 1. スコープと位置付け

### 1.1 本書の責務

TranCall モバイルアプリ (React Native + Expo) と OS ネイティブ通話 UI (iOS CallKit / Android Telecom) を橋渡しする native bridge レイヤの設計を canonical に確定する。

具体的には次の 4 つの境界:

1. **VoIP Push** (APNs PushKit / FCM data message) → ネイティブ通話 UI への即時通知投入
2. **ネイティブ通話 UI** (CXProvider / SelfManagedConnectionService) → React Native JS への状態通知
3. **React Native JS** → ネイティブ通話 UI へのアクション指示 (応答 / 終話 / mute)
4. **ネイティブ通話 UI** → LiveKit Room SDK の音声セッション制御 (AVAudioSession / AudioManager)

### 1.2 非スコープ

- **LiveKit Room の発信側ロジック**: `apps/mobile` の `CallStore` と `media facade` 経由の REST API 呼び出しが担う。本書はネイティブ通話 UI が active になった後の audio routing のみを扱う。
- **Push 配信サーバー実装**: `notification module` (`packages/notification/src/adapters/{apns,fcm}.ts`) の責務。`docs/notification-detail.md` が canonical。
- **アプリ全体の状態管理**: `apps/mobile/src/stores/CallStore.ts` (Zustand) の設計は別 PR スコープ。本書は Native ⇄ JS 境界のイベント schema のみ規定。
- **Phase 1c 以降**: グループ通話 (49 人)、ビデオ通話、画面共有、Hold/Resume、複数同時通話 (`maximumCallGroups >= 2`)。

### 1.3 関連 Sprint 2 設計 PR との依存関係

| 上流 PR | 提供物 | 本書での参照 |
|---|---|---|
| #28 D1 (`docs/translation-pipeline-design.md`) | 翻訳セッション開始/終了の Agent 側挙動 | §4.8, §5.8 (CallKit answer 後の Translation Agent 起動タイミング参照) |
| #28 D3 (`docs/module-contracts.md` v1.1.0) | `NotificationFacade.sendIncomingCall` 契約、HMAC 署名仕様 | §6.4 (push payload 構造)、§12.1 (HMAC 検証) |
| #29 D2 (`docs/deployment-render-dryrun.md`) | APNs / FCM key の 1Password vault 配布 | §13.2, §13.3 (Sprint 3 着手時の secrets 配布手順) |

---

## 2. 用語と前提

### 2.1 用語

| 用語 | 定義 |
|---|---|
| **CallKit** | iOS 10+ で導入された VoIP 通話の OS 標準 UI フレームワーク。`CXProvider` / `CXCallController` / `CXProviderDelegate` を中心に構成。 |
| **PushKit** | CallKit と組み合わせて使う VoIP 専用 Push 受信フレームワーク。`PKPushRegistry` / `PKPushRegistryDelegate`。 |
| **VoIP Push** | APNs の `apns-push-type: voip` で送る通常 push と別経路の Push。data-only payload、優先度高、background でも即配信。 |
| **CXAction** | CallKit のユーザー操作 (応答 / 終話 / mute / hold) を表す抽象クラス。`CXAnswerCallAction` 等。 |
| **AVAudioSession** | iOS の音声入出力ルーティングを管理する singleton。CallKit 利用時は CallKit が一部の制御を奪う。 |
| **Telecom Framework** | Android 5.0 (API 21) で導入された通話 UI 統合フレームワーク。`TelecomManager` / `ConnectionService` / `Connection` / `PhoneAccount`。VoIP 用途の Self-Managed ConnectionService は API 26+ で利用可能。 |
| **SelfManagedConnectionService** | VoIP/通話アプリ向けの ConnectionService 派生型。アプリ自前の UI を持つことが前提 (システム標準通話 UI に統合されない)。 |
| **PhoneAccount** | Telecom が認識する通話アカウント単位。アプリは起動時に `registerPhoneAccount` でシステム登録する。 |
| **FCM data message** | Firebase Cloud Messaging の data-only payload (notification キーなし)。Doze を突破して `onMessageReceived` を起動できる (high_priority 指定時)。 |
| **PKPushType.voIP** | PushKit が扱う Push 種別。アプリが kill 状態でも `didReceiveIncomingPushWith` が呼ばれる唯一の Push 種別。 |
| **Native Module** | React Native から native (Swift/Kotlin) コードを呼び出すブリッジ機構。本書では Expo Modules API を採用。 |

### 2.2 前提条件

#### 2.2.1 Apple Developer Account

| 項目 | 内容 |
|---|---|
| 必要 entitlement | `Background Modes: Voice over IP`, `Background Modes: Audio, AirPlay, Picture in Picture`, `Push Notifications` |
| 必要 capability | App ID に `Push Notifications` のみ (本書は APNs auth key 方式を採用するため、別途 `VoIP Services Certificate` capability は不要) |
| 必要証明書 / 鍵 | APNs auth key (`*.p8`) 1 本のみを採用 (VoIP / 通常 push 双方を 1 つの key でカバーでき、rotation も容易)。VoIP Services Certificate (`*.p12`) は使用しない |
| App Store Review 配慮 | CallKit 利用は VoIP 通話アプリのみ許可。SMS / 一般 push 用に CallKit を使うと App Review でリジェクトされる事例あり |

#### 2.2.2 Google Play / Android

| 項目 | 内容 |
|---|---|
| 必要 permission | `android.permission.MANAGE_OWN_CALLS` (Self-Managed ConnectionService 必須)、`android.permission.FOREGROUND_SERVICE` (常時)、`android.permission.FOREGROUND_SERVICE_PHONE_CALL` (Android 14+ で通話用 ForegroundService に必須)、`android.permission.RECORD_AUDIO`、`android.permission.POST_NOTIFICATIONS` (Android 13+) |
| 不要 permission | `CALL_PHONE` (テレフォニー機能不要)、`READ_PHONE_STATE` (Self-Managed では不要)、`ANSWER_PHONE_CALLS` (テレフォニー API 専用) |
| FCM | Firebase プロジェクトに sender_id / Server Key を登録、`google-services.json` を `apps/mobile/android/app/` に配置 |
| Play Console | Sensitive permissions 申告 (`MANAGE_OWN_CALLS` は通常審査不要だが、`FOREGROUND_SERVICE_PHONE_CALL` の用途宣言が Android 14 以降必須) |

#### 2.2.3 LiveKit / OpenAI 関連

| 項目 | 内容 |
|---|---|
| LiveKit Mobile SDK | `@livekit/react-native` v2.x を採用。AudioSession 管理は SDK が一部担うが、CallKit / Telecom と協調するため本 bridge が optimal config を流し込む |
| 翻訳 Agent | 本 bridge は Translation Agent (LiveKit 上で動く別プロセス) には直接関与しない。Agent の起動タイミングは Server (room facade) が `room.participant_joined` event を契機に LiveKit Agent Cloud にリクエストする (`docs/translation-pipeline-design.md` §3 参照) |

---

## 3. 全体アーキテクチャ

### 3.1 構成図

```
┌─────────────────────────────────────────────────────────────────────┐
│                         iOS デバイス                                  │
│                                                                       │
│  ┌────────────┐  VoIP Push    ┌───────────────┐                       │
│  │  APNs      │─────────────▶│  PushKit      │                       │
│  │  (Apple)   │  data-only    │  PKPushRegistry│                      │
│  └────────────┘               └────────┬──────┘                       │
│                                        │ didReceiveIncomingPushWith    │
│                                        ▼                               │
│                              ┌──────────────────────┐                  │
│                              │  CallBridge (Swift)  │                  │
│                              │  - PushKitDelegate    │                  │
│                              │  - CXProviderDelegate │                  │
│                              │  - AVAudioSession     │                  │
│                              └─────┬────────────┬───┘                  │
│                              event │            │ command              │
│                                    ▼            │                      │
│                              ┌──────────────────────┐                  │
│                              │  CallKit (CXProvider)│                  │
│                              │  - 着信 UI (system)  │                  │
│                              │  - Lock screen 統合  │                  │
│                              └──────────────────────┘                  │
│                                    │                                   │
│                              answer/end action                        │
│                                    ▼                                   │
│                              ┌──────────────────────┐                  │
│                              │  CallBridge → JS     │                  │
│                              │  (Expo Module)        │                  │
│                              └────────┬─────────────┘                  │
│                                       │ EventEmitter                   │
│                                       ▼                                │
│                              ┌──────────────────────┐                  │
│                              │  React Native JS     │                  │
│                              │  CallStore (Zustand) │                  │
│                              │  + LiveKit RN SDK    │                  │
│                              └────────┬─────────────┘                  │
│                                       │                                │
│                                       │ room.connect(token)            │
│                                       ▼                                │
└──────────────────────────────────────┼─────────────────────────────────┘
                                        │
                                        ▼
                              ┌──────────────────────┐
                              │  LiveKit SFU         │
                              │  (Cloud / 自社)      │
                              └──────────────────────┘
```

Android 側は `PushKit` の代わりに `FCM data message` + `MyFirebaseMessagingService`、`CallKit` の代わりに `SelfManagedConnectionService` が同位置に立つ。それ以外の構造 (Native bridge → Expo Module → JS → LiveKit) は同形。

### 3.2 通信フロー (4 シナリオ)

#### 3.2.1 発信 (アプリ前景、Caller 側)

1. ユーザーが連絡先から発信ボタンを押す
2. JS: `apiClient.post('/rooms', { inviteeIds, translationEnabled })` → server から `{ roomId, token }` を取得
3. JS: `CallBridge.startOutgoingCall({ uuid, calleeName, roomId })` を呼ぶ
4. Native (iOS): `CXCallController.requestTransaction(CXStartCallAction)` で発信を CallKit に申告 → CXProvider が outgoing call UI を表示
5. Native (Android): `TelecomManager.placeCall(uri, extras)` で発信を Telecom に申告 → SelfManagedConnectionService.onCreateOutgoingConnection
6. Native: AudioSession を `playAndRecord / voiceChat` (iOS) または `MODE_IN_COMMUNICATION` (Android) に切替
7. JS: `room.connect(url, token)` で LiveKit Room へ接続、`publishTrack(mic)` で送信開始
8. server → callee デバイスに VoIP Push 配信 (詳細 §3.2.2 へ)
9. callee 応答 → server → caller の LiveKit Room に participant_joined event → JS は CallStore を `active` に遷移、Native bridge に `markCallActive(uuid)` を通知

#### 3.2.2 着信 (Callee 側、アプリ killed/background)

1. server → APNs (iOS) / FCM (Android) に VoIP Push 配信
2. **iOS**: `PKPushRegistryDelegate.pushRegistry(_:didReceiveIncomingPushWith:for:completion:)` 起動
   - **5 秒以内** に `CXProvider.reportNewIncomingCall(with:update:completion:)` を呼ばないと iOS が即時にアプリを kill、さらに以降の VoIP Push 受信権限が剥奪される (iOS 13+ で厳格化、`PKPushRegistryDelegate` doc 参照)
3. **Android**: `MyFirebaseMessagingService.onMessageReceived` 起動 (high_priority data message)
   - `TelecomManager.addNewIncomingCall(phoneAccountHandle, extras)` で Telecom にエントリ
   - **Android 12+ (API 31+)**: `Service.startForeground(...)` を `Context.startForegroundService` から 5 秒以内に呼ばないと `ForegroundServiceDidNotStartInTimeException` で異常終了 (Android 12 で導入)。**Android 14+ (API 34+)**: 加えて `foregroundServiceType = FOREGROUND_SERVICE_TYPE_PHONE_CALL` の明示と `FOREGROUND_SERVICE_PHONE_CALL` permission が必須
4. CallKit / Telecom が Lock screen / 着信 UI を表示
5. ユーザーが応答ボタンを押す
   - iOS: `CXProviderDelegate.provider(_:perform:CXAnswerCallAction)` 起動 → `action.fulfill()` を即時呼出
   - Android: `Connection.onAnswer()` 起動 → `setActive()` を呼出
6. Native は **AudioSession の設定変更のみ** を担う (iOS は CallKit が `provider(_:didActivate:)` を呼んだタイミングで `AVAudioSession.setCategory(.playAndRecord, mode: .voiceChat, options:)` を実行。Android は `Connection.onAnswer()` 内で `AudioManager.mode = MODE_IN_COMMUNICATION` に切替)。**LiveKit room.connect は Native では行わず、必ず JS 側で実行する** (LiveKit RN SDK は JS ランタイム上で動くため)
7. Native → JS: `callBridge.emit('callAnswered', { uuid, roomId })` で React Native JS に通知
8. JS: `apiClient.post('/rooms/:id/join')` → token 取得 → `room.connect(url, token)` → `publishTrack(mic)` → CallStore を `active` に遷移
9. JS → Native: `markCallActive(uuid)` (Native は CallKit/Telecom 側の状態を確定状態に遷移)

#### 3.2.3 通話中の OS イベント

| イベント | iOS | Android | bridge 動作 |
|---|---|---|---|
| 端末ロック | CallKit が継続管理、AudioSession 維持 | ConnectionService.setActive 維持 | bridge 動作なし (LiveKit room も継続) |
| 他アプリ着信 (電話) | CallKit が hold 要求 (`CXSetHeldCallAction`) | TelecomManager が hold 要求 (`Connection.onHold`) | bridge は LiveKit `room.disconnect` せず、`localAudioTrack.setEnabled(false)` で mute、Phase 1a では hold 受け入れ後すぐ end とする (Phase 1b で本格的 hold 対応) |
| Bluetooth route 切替 | `AVAudioSession.routeChangeNotification` | `AudioDeviceCallback.onAudioDevicesAdded` | bridge が JS に `audioRouteChanged` を emit、UI は表示更新のみ (LiveKit SDK が経路追従) |
| ヘッドセット切断 | 同上 | 同上 | 同上 |
| 通話アプリ kill | OS が CallKit/Telecom 側 force-end | OS が ConnectionService.onAbort | bridge → JS に `callEnded { reason: 'force_terminated' }`、JS は server に best-effort で leave POST |

#### 3.2.4 終話

1. ユーザーが CallKit / Telecom UI または React Native UI の終話ボタンを押す
2. CallKit/Telecom 側ボタンの場合: bridge → JS に `callEnded { reason: 'user' }` 通知
3. RN UI 側ボタンの場合: JS が `callBridge.endCall(uuid)` を呼び、bridge が CallKit/Telecom に終了報告
4. JS: `room.disconnect()` → `apiClient.post('/rooms/:id/leave')` (best-effort)
5. Native: AudioSession を default に戻す、Foreground service stop (Android)
6. CallKit/Telecom UI が消える、Recents 履歴に通話エントリが残る (iOS は CallKit 統合 Recents、Android は SelfManaged では原則アプリ独自履歴)

### 3.3 Native Module 採用方針

**Expo Modules API** を採用する (Expo SDK 54+、`expo-modules-core`)。

| 候補 | 採用判断 | 理由 |
|---|---|---|
| **Expo Modules API** | **採用** | Swift / Kotlin で書ける。TurboModule (New Architecture) と Legacy Bridge の両対応を Expo が抽象化済み。`expo-modules-autolinking` で iOS/Android プロジェクト構成自動化 |
| React Native TurboModule (純正) | 不採用 | 手動の codegen / project 設定コストが大きい。Expo Modules API の薄いラッパとして TurboModule を吐く動作になるので機能差はほぼない |
| react-native-callkeep (OSS) | 不採用 (依存しない) | iOS CallKit + Android ConnectionService を一通り抽象化する OSS だが、Self-Managed Telecom + Android 14 ForegroundService 厳格化への追従が遅い、AudioSession の細かい制御が困難。TranCall の bridge は薄く 1 から書く方が中長期保守コストが低い |

### 3.4 単一責任の境界

| レイヤ | 責務 | 例 |
|---|---|---|
| **Native (Swift / Kotlin)** | OS API ラッパー | `CXProvider.reportNewIncomingCall`, `TelecomManager.addNewIncomingCall`, `AVAudioSession.setCategory` |
| **JS Bridge (Expo Module の TS インタフェース)** | Native 関数呼出と event subscribe の薄いラッパ + Zod 検証 | `callBridge.reportIncomingCall(payload)`、`callBridge.on('callAnswered', handler)` |
| **JS ビジネスロジック (CallStore)** | call state 管理、LiveKit Room との連携、UI 状態反映 | `useCallStore` (Zustand) |
| **JS UI** | CallKit/Telecom の native UI を補完する画面 (incoming overlay の RN 側 UI、in-call の字幕 overlay 等) | `screens/IncomingCallScreen.tsx` |

**禁止事項**:
- Native 層に business logic (LiveKit token 取得 / API 呼出) を書かない。Native は OS API ラッパーに徹する。
- JS から直接 `RNNativeModules.call_kit_provider.CXProvider...` のような raw bridge にアクセスしない。必ず `callBridge` 経由。
- Native event 受信 → JS で同期処理しない (UI フリーズリスク)。必ず Zustand state 経由。

---

## 4. iOS CallKit + PushKit 設計

### 4.1 entitlement / capability

`apps/mobile/ios/TranCall.entitlements` に以下を含める:

```xml
<key>aps-environment</key>
<string>production</string>  <!-- dev では development -->
```

`com.apple.developer.usernotifications.communication` (Communication Notifications / `INSendMessageIntent` 統合用 entitlement) は VoIP 通話用途では **不要**、誤って含めると App Review で Communication Notifications の実装証跡を要求されリジェクト誘発のリスクがある。本書スコープでは付けない。

`apps/mobile/ios/TranCall/Info.plist` に以下を追加:

```xml
<key>UIBackgroundModes</key>
<array>
  <string>voip</string>     <!-- PushKit + CallKit に必須 -->
  <string>audio</string>    <!-- 通話中の background audio 継続 -->
</array>
<key>NSMicrophoneUsageDescription</key>
<string>翻訳通話に音声を送信するためマイクを使用します</string>
```

App ID には Apple Developer Console で **Push Notifications** capability を有効化、APNs auth key (`*.p8`) を 1 本発行する (§2.2.1、`*.p12` Certificate 方式は採用しない)。

### 4.2 CXProvider configuration

```swift
// apps/mobile/ios/CallBridge/CallBridgeProvider.swift
import CallKit

let config = CXProviderConfiguration()
config.supportsVideo = false  // Phase 1a は音声のみ
config.maximumCallGroups = 1  // Phase 1a は同時 1 通話
config.maximumCallsPerCallGroup = 1
config.supportedHandleTypes = [.generic]  // trancall_id を generic で扱う
config.iconTemplateImageData = UIImage(named: "trancall-callkit-icon")?.pngData()
config.ringtoneSound = nil  // OS 標準着信音を使用 (§14 リスク #8: カスタム ringtone は App Review 指摘リスク)
config.includesCallsInRecents = true  // iOS Recents に通話履歴を残す

let provider = CXProvider(configuration: config)
provider.setDelegate(self, queue: nil)
```

**注意**:
- `supportsVideo = true` を設定すると CallKit UI に video アイコンが出るが、Phase 1a は音声のみのため `false`。
- `iconTemplateImageData` は **アルファチャンネル付き 40x40 png** 必須 (Apple HIG)。`packages/ui-kit/assets/trancall-icon.svg` から書き出す。

### 4.3 PushKit registration

```swift
// apps/mobile/ios/CallBridge/PushKitDelegate.swift
import PushKit

class PushKitDelegate: NSObject, PKPushRegistryDelegate {
  private let registry: PKPushRegistry

  init() {
    registry = PKPushRegistry(queue: nil)
    super.init()
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
  }

  func pushRegistry(_ registry: PKPushRegistry,
                    didUpdate pushCredentials: PKPushCredentials,
                    for type: PKPushType) {
    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    // RN bridge 経由で server に登録
    CallBridgeModule.emitDeviceToken(token: token, platform: "ios")
  }

  func pushRegistry(_ registry: PKPushRegistry,
                    didReceiveIncomingPushWith payload: PKPushPayload,
                    for type: PKPushType,
                    completion: @escaping () -> Void) {
    // ★★ 5 秒以内に必ず CXProvider.reportNewIncomingCall を呼ぶこと ★★
    // 失敗・遅延時はアプリ kill + VoIP Push 受信権限剥奪

    // payload は { "aps": {}, "trancall": { ... } } の nested 構造 (notification-detail.md §1 canonical)
    guard let trancall = payload.dictionaryPayload["trancall"] as? [String: Any] else {
      completion()
      return
    }

    let uuid = UUID(uuidString: trancall["uuid"] as? String ?? "") ?? UUID()

    // ※ HMAC 署名検証 / expiresAt 検証はここで実施 (notification-detail.md §3.4 参照、CryptoKit HMAC<SHA256>)。
    //    検証失敗時は CXProvider を呼ばずに completion() のみ。

    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic,
                                    value: trancall["callerTrancallId"] as? String ?? "unknown")
    update.localizedCallerName = trancall["callerName"] as? String
    update.hasVideo = false

    CallBridgeProvider.shared.reportNewIncomingCall(with: uuid, update: update) { error in
      if let error = error {
        // ログのみ。completion は必ず呼ぶこと
        NSLog("[CallBridge] reportNewIncomingCall failed: \(error)")
      }
      completion()  // ★ completion を必ず呼ぶ ★
    }
  }
}

// 注: `PKPushRegistry(queue: nil)` は delegate コールバックを main queue で受ける指定。
// 本書の delegate 実装は HMAC 検証 (CryptoKit) + reportNewIncomingCall のみで同期処理が軽く main queue で問題ない。
// ただし将来の拡張 (certificate pinning, network lookup, 重い検証など) を考慮し、
// Sprint 3 実装時には専用 serial queue (`DispatchQueue(label: "tech.hori.trancall.pushkit", qos: .userInitiated)`)
// を渡す形を強く推奨する。queue 変更しても 5 秒 rule 厳守は同様 (queue は serial であること必須、concurrent は不可)。
```

### 4.4 CXProviderDelegate ハンドラ

```swift
extension CallBridgeProvider: CXProviderDelegate {
  func providerDidReset(_ provider: CXProvider) {
    // OS が provider 状態をリセット (アプリ更新等)。ongoing call を全て破棄
    activeCallUUIDs.removeAll()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    // ユーザーが応答ボタンを押した
    // ここでは action.fulfill() を呼ぶだけ。実際の audio session activation は
    // didActivate audioSession で行う (CallKit のライフサイクル仕様)
    CallBridgeModule.emitCallAnswered(uuid: action.callUUID.uuidString)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    CallBridgeModule.emitCallEnded(uuid: action.callUUID.uuidString, reason: "user")
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    CallBridgeModule.emitCallMuted(uuid: action.callUUID.uuidString, muted: action.isMuted)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    // ★ CallKit が AudioSession を activate したタイミング ★
    // この時点で LiveKit SDK の audio session 設定が反映される
    // allowBluetooth (HFP) は Bluetooth ヘッドセットのマイク入力に必須、allowBluetoothA2DP は出力品質向上用
    try? audioSession.setCategory(.playAndRecord,
                                   mode: .voiceChat,
                                   options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP])
    try? audioSession.setPreferredSampleRate(48000)  // LiveKit Opus 48kHz と整合
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    // 通話終了後、CallKit が AudioSession を deactivate
  }
}
```

### 4.5 着信フロー (要点まとめ)

```
APNs VoIP Push (notification-detail.md §1 の nested payload)
   │
   ▼
PKPushRegistryDelegate.pushRegistry(_:didReceiveIncomingPushWith:for:completion:)
   │
   │ ★ 5 秒以内厳守 ★
   ▼ payload.dictionaryPayload["trancall"] を取り出し、HMAC + expiresAt 検証
   │
   ▼ 検証 OK の場合のみ:
CXProvider.reportNewIncomingCall(with: uuid, update: update) { error in completion() }
   │
   ▼
CallKit が UI 表示 (Lock screen / 通知センター)
   │
   ▼
ユーザー応答
   │
   ▼
CXProviderDelegate.provider(_:perform:CXAnswerCallAction) → action.fulfill()
   │
   ▼ Native → JS event 'callAnswered'
   │
   ▼ JS が apiClient.post('/rooms/:id/join') → token 取得 → room.connect
   │
   ▼
provider(_:didActivate:) コールバックで AVAudioSession 設定 (Apple 推奨の正規タイミング)
   │
   ▼
LiveKit が publishTrack(mic) 開始 (JS 側で実行)
```

注: `CXProvider.reportOutgoingCall(with:connectedAt:)` は **発信側 (caller) 専用 API** であり、着信応答フローでは呼ばない (誤って呼ぶと CallKit 側で "unexpected call state" エラー)。発信フローのアクティブ確定は §3.2.1 を参照。

### 4.6 終話 / cleanup

```swift
// JS から callBridge.endCall(uuid) を呼ぶケース
func endCall(uuid: UUID) {
  let action = CXEndCallAction(call: uuid)
  let transaction = CXTransaction(action: action)
  CXCallController().request(transaction) { error in
    // 失敗時はログのみ。CallKit が provider state を整合
  }
}

// CallKit から fulfill された後、bridge は LiveKit room を切る
// JS 側: callBridge.on('callEnded', ({ uuid, reason }) => {
//   void liveKitRoom.disconnect();
//   void apiClient.post(`/rooms/${roomId}/leave`).catch(() => {});
// });
```

### 4.7 AVAudioSession の協調

CallKit 利用時、AVAudioSession の category 変更は **`provider(_:didActivate:)` 内で行うのが正規** (Apple doc: CallKit Programming Guide)。CallKit 側が audio session を一時的に乗っ取るため、`viewDidAppear` 等で設定すると上書きされる。

LiveKit RN SDK は内部で AVAudioSession を触るが、CallKit と協調させるため次の設定を採用:

```ts
// apps/mobile/src/lib/livekit/audio-session.ts
import { AudioSession } from "@livekit/react-native";

// CallKit から callAnswered を受けた直後に呼ぶ
await AudioSession.configureAudio({
  ios: {
    defaultOutput: "speaker",  // ハンズフリー優先
    audioCategoryOptions: ["allowBluetooth", "allowBluetoothA2DP", "defaultToSpeaker"],
    audioMode: "voiceChat",
  },
});
// AudioSession.startAudioSession() は CallKit の didActivate が発火した「後」に呼ぶ。
// LiveKit RN SDK の AudioSession は CallKit が AVAudioSession を activate した瞬間と協調するため、
// startAudioSession を didActivate より早く呼ぶと CallKit と category 競合する。
// 実装では Native bridge の 'didActivate' event を購読してから startAudioSession を呼ぶ pattern を採用。
await AudioSession.startAudioSession();
```

---

## 5. Android Telecom + ConnectionService 設計

### 5.1 permissions

`apps/mobile/android/app/src/main/AndroidManifest.xml` に以下を含める:

```xml
<uses-permission android:name="android.permission.MANAGE_OWN_CALLS" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_PHONE_CALL" />
<!-- Android 13 (API 33) 以上で push 通知に必要 -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<!-- 注: com.google.android.c2dm.permission.RECEIVE は Firebase Messaging SDK
     (v21+) が内部で自動宣言するため、アプリ側での明示宣言は不要 -->

<service
    android:name=".CallConnectionService"
    android:permission="android.permission.BIND_TELECOM_CONNECTION_SERVICE"
    android:exported="true">
  <intent-filter>
    <action android:name="android.telecom.ConnectionService" />
  </intent-filter>
</service>

<service
    android:name=".CallForegroundService"
    android:foregroundServiceType="phoneCall"
    android:exported="false" />

<service
    android:name=".TranCallFirebaseMessagingService"
    android:exported="false">
  <intent-filter>
    <action android:name="com.google.firebase.MESSAGING_EVENT" />
  </intent-filter>
</service>
```

`MANAGE_OWN_CALLS` は API 26+ で **normal permission**、manifest 宣言のみでインストール時に自動付与される (runtime request 不可)。`POST_NOTIFICATIONS` は Android 13+ で **dangerous permission** のため runtime 要求が必要。`FOREGROUND_SERVICE_PHONE_CALL` は Android 14+ で **必須**、未付与で `SecurityException` 発生 (Android 14 で導入された通話用 ForegroundService 専用 permission)。

### 5.2 PhoneAccount 登録

```kotlin
// apps/mobile/android/app/src/main/java/tech/hori/trancall/TranCallApplication.kt
class TranCallApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    registerPhoneAccount()
  }

  private fun registerPhoneAccount() {
    val telecomManager = getSystemService(TELECOM_SERVICE) as TelecomManager
    val handle = PhoneAccountHandle(
      ComponentName(this, CallConnectionService::class.java),
      "trancall-self-managed"
    )
    val account = PhoneAccount.builder(handle, "TranCall")
      .setCapabilities(
        // Phase 1a は音声のみ。VIDEO capability は Phase 2 で追加する
        // (CAPABILITY_VIDEO_CALLING を Phase 1a で付与すると Play Console 申請時に video 機能の宣言を要求される可能性)
        PhoneAccount.CAPABILITY_SELF_MANAGED  // VoIP / 自社 UI
      )
      .setShortDescription("TranCall 翻訳通話")
      .build()
    telecomManager.registerPhoneAccount(account)
  }
}
```

### 5.3 着信フロー: FCM data message → Telecom

```kotlin
// TranCallFirebaseMessagingService.kt
class TranCallFirebaseMessagingService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    if (data["type"] != "incoming_call") return

    val uuid = data["uuid"] ?: return
    val callerName = data["callerName"] ?: "Unknown"
    val callerTrancallId = data["callerTrancallId"] ?: ""

    val telecomManager = getSystemService(TELECOM_SERVICE) as TelecomManager
    val handle = PhoneAccountHandle(
      ComponentName(this, CallConnectionService::class.java),
      "trancall-self-managed"
    )
    val extras = Bundle().apply {
      putString(CallConnectionService.EXTRA_UUID, uuid)
      putString(CallConnectionService.EXTRA_CALLER_NAME, callerName)
      putString(CallConnectionService.EXTRA_CALLER_TRANCALL_ID, callerTrancallId)
      putString(CallConnectionService.EXTRA_ROOM_ID, data["roomId"] ?: "")
    }
    val callExtras = Bundle().apply {
      putParcelable(TelecomManager.EXTRA_INCOMING_CALL_ADDRESS,
                    Uri.fromParts("trancall", callerTrancallId, null))
      putBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS, extras)
    }
    telecomManager.addNewIncomingCall(handle, callExtras)
  }

  override fun onNewToken(token: String) {
    // RN bridge 経由で server に登録
    CallBridgeModule.emitDeviceToken(token, "android")
  }
}
```

### 5.4 ConnectionService と Connection 実装

```kotlin
class CallConnectionService : ConnectionService() {
  override fun onCreateIncomingConnection(
    connectionManagerPhoneAccount: PhoneAccountHandle?,
    request: ConnectionRequest?
  ): Connection {
    val extras = request?.extras?.getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS)
    val uuid = extras?.getString(EXTRA_UUID) ?: UUID.randomUUID().toString()

    val connection = TranCallConnection(applicationContext, uuid).apply {
      setRinging()
      setCallerDisplayName(
        extras?.getString(EXTRA_CALLER_NAME) ?: "Unknown",
        TelecomManager.PRESENTATION_ALLOWED
      )
      setAddress(request?.address, TelecomManager.PRESENTATION_ALLOWED)
      audioModeIsVoip = true
      connectionProperties = Connection.PROPERTY_SELF_MANAGED
    }

    // ★ Android 14+: ForegroundService を 5 秒以内に startForeground する ★
    val intent = Intent(this, CallForegroundService::class.java).apply {
      putExtra(EXTRA_UUID, uuid)
    }
    ContextCompat.startForegroundService(this, intent)

    // RN JS に通知
    CallBridgeModule.emitIncomingCall(
      uuid = uuid,
      callerName = extras?.getString(EXTRA_CALLER_NAME) ?: "",
      callerTrancallId = extras?.getString(EXTRA_CALLER_TRANCALL_ID) ?: "",
      roomId = extras?.getString(EXTRA_ROOM_ID) ?: ""
    )

    return connection
  }
}

class TranCallConnection(
  private val context: Context,
  val callUuid: String,
) : Connection() {
  init {
    setConnectionCapabilities(CAPABILITY_MUTE)
    setAudioModeIsVoip(true)
  }

  override fun onAnswer() {
    setActive()
    val audioManager = context.getSystemService(AUDIO_SERVICE) as AudioManager
    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    CallBridgeModule.emitCallAnswered(callUuid)
  }

  override fun onDisconnect() {
    setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
    destroy()
    val intent = Intent(context, CallForegroundService::class.java)
    context.stopService(intent)
    CallBridgeModule.emitCallEnded(callUuid, "user")
  }

  override fun onAbort() {
    setDisconnected(DisconnectCause(DisconnectCause.OTHER))
    destroy()
    CallBridgeModule.emitCallEnded(callUuid, "force_terminated")
  }

  override fun onCallAudioStateChanged(state: CallAudioState) {
    CallBridgeModule.emitAudioRouteChanged(callUuid, state.route.toString())
  }
}
```

### 5.5 ForegroundService for audio (Android 14 以降必須)

```kotlin
class CallForegroundService : Service() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val uuid = intent?.getStringExtra(EXTRA_UUID) ?: ""
    val notification = NotificationCompat.Builder(this, "trancall_call_channel")
      .setContentTitle("通話中")
      .setContentText("TranCall で通話中")
      .setSmallIcon(R.drawable.ic_call)
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .build()

    // ★ Android 14+: foregroundServiceType を必ず指定 ★
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
```

### 5.6 AudioManager 設定

`Connection.onAnswer()` 内で `AudioManager.MODE_IN_COMMUNICATION` に切替。LiveKit RN SDK は `WebRTC.setAudioMode` を内部で叩くが、Self-Managed Telecom では bridge 側で先に `MODE_IN_COMMUNICATION` を設定しないと echo cancellation が効かない。

speakerphone は CallKit 同様 `setSpeakerphoneOn(true)` をデフォルト (ハンズフリー優先)、`callBridge.setSpeakerphone(false)` で受話器モードに切替可能。

---

## 6. VoIP Push 設計

### 6.1 iOS PushKit payload 仕様

| 項目 | 値 |
|---|---|
| APNs topic | `tech.hori.trancall.voip` (Bundle ID + `.voip` suffix) |
| `apns-push-type` | `voip` |
| `apns-priority` | `10` (即時配信) |
| `apns-expiration` | `0` (即時のみ、保持しない) |
| 認証 | APNs auth key (`*.p8`) を `notification` module の `apns adapter` で署名 |

Payload は `docs/notification-detail.md` §1 で canonical 定義。本書では bridge 観点で要点のみ示す。**構造は nested** (`aps` キー + `trancall` キー):

```json
{
  "aps": {},
  "trancall": {
    "type": "incoming_call",
    "uuid": "fe2b8410-3a72-44f0-8d3a-2f6b3c9e1d77",
    "roomId": "room_xyz789",
    "callerId": "u_abc123",
    "callerName": "山田太郎",
    "callerAvatarUrl": "https://...",
    "callerTrancallId": "@yamada_taro",
    "roomType": "audio",
    "translationEnabled": true,
    "languagePair": "ja-en",
    "callerLanguage": "ja",
    "issuedAt": "2026-05-12T10:23:45.000Z",
    "expiresAt": "2026-05-12T10:24:15.000Z",
    "signature": "<HMAC-SHA256, 64 hex chars>"
  }
}
```

- `uuid` は **CallKit 専用 UUID** (CallKit `reportNewIncomingCall(with: UUID)` に渡す)。`roomId` (LiveKit room 識別子) と独立。
- payload 上限 5KB (VoIP push の APNs 上限)。`signature` 含めて約 1KB に収まる。
- 全フィールドの canonical 定義は `notification-detail.md` §1。本書から重複定義しない。

### 6.2 Android FCM data message 仕様

FCM Legacy HTTP API (v0、`"to": "<token>"`) は 2024-06 廃止済。**HTTP v1 API** (`message.token` + `message.data` + `message.android`) を採用。`firebase-admin` の `messaging.send` ラッパで送る (`packages/notification/src/adapters/fcm-adapter.ts` 実装済)。

```json
{
  "message": {
    "token": "<fcm-device-token>",
    "data": {
      "type": "incoming_call",
      "uuid": "fe2b8410-3a72-44f0-8d3a-2f6b3c9e1d77",
      "roomId": "room_xyz789",
      "callerId": "u_abc123",
      "callerName": "山田太郎",
      "callerAvatarUrl": "https://...",
      "callerTrancallId": "@yamada_taro",
      "roomType": "audio",
      "translationEnabled": "true",
      "languagePair": "ja-en",
      "callerLanguage": "ja",
      "issuedAt": "2026-05-12T10:23:45.000Z",
      "expiresAt": "2026-05-12T10:24:15.000Z",
      "signature": "<HMAC-SHA256, 64 hex chars>"
    },
    "android": {
      "priority": "high",
      "ttl": "30s"
    }
  }
}
```

- `notification` キーは含めない (含めると Doze 中に Notification Tray にしか出ず、`onMessageReceived` が起動しない)。
- `message.android.priority: "high"` は Android が Doze を突破するのに必須。
- `data` フィールド値は **string 型のみ** (FCM の制約)。`translationEnabled` は `"true"` / `"false"`、boolean リテラルは使わない。
- 全フィールドの canonical 定義は `notification-detail.md` §2。

### 6.3 Push payload の canonical 配置

| canonical 文書 | Scope |
|---|---|
| `docs/notification-detail.md` §1-§3 | payload 構造 + HMAC 仕様 (この設計が真) |
| `packages/notification/src/schemas.ts` の `ApnsVoipPayloadSchema` / `FcmDataPayloadSchema` | 実装側 Zod schema (現状 v1.0 相当、Sprint 3 で v1.1 拡張フィールド `uuid` / `callerId` / `issuedAt` / `expiresAt` / `signature` を追加) |
| `packages/notification/src/schemas.ts` の `IncomingCallNotificationSchema` | Server 内部 (facade → adapter 間) で使う Notification 形式。adapter が APNs/FCM 形式に変換 |

本書では新規 schema を **追加定義しない**。Sprint 3 の実装タスクで以下を実施:

1. `packages/notification/src/schemas.ts` の `ApnsVoipPayloadSchema.trancall` および `FcmDataPayloadSchema` に `uuid` / `callerId` / `issuedAt` / `expiresAt` / `signature` を追加 (`notification-detail.md` v1.3 と整合)
2. `packages/notification/src/adapters/apns-adapter.ts` / `fcm-adapter.ts` が HMAC 署名計算 (`notification-detail.md` §3) を組み込む
3. Mobile bridge (`apps/mobile/modules/call-bridge/`) が APNs/FCM payload を Swift `Codable` / Kotlin `kotlinx.serialization` でデコードし HMAC 検証

Server (notification module) と Mobile bridge は同じ canonical (`notification-detail.md`) を参照し、互換性 test (Layer 3-3 CI) で互換性を継続確認する。

### 6.4 NotificationFacade との関係

`module-contracts.md` v1.1.0 §2.5 で `NotificationFacade.sendIncomingCall(targetUserId, notification: IncomingCallNotification)` が canonical。本書はその adapter 層 (`packages/notification/src/adapters/{apns,fcm}.ts`) が `notification-detail.md` v1.3 に従って APNs/FCM payload を構築する責務を補強する。

#### IncomingCallNotification と APNs/FCM payload のフィールド対応

`packages/notification/src/schemas.ts` の `IncomingCallNotificationSchema` は server 内部の中間表現。adapter が `notification-detail.md` §1 / §2 の wire format に変換する。Sprint 3 拡張後の対応関係:

| `IncomingCallNotification` フィールド | APNs `trancall.*` (top-level `trancall` キー配下) | FCM `message.data.*` | 備考 |
|---|---|---|---|
| (server で生成) | `uuid` | `uuid` | CallKit 用 UUID、`crypto.randomUUID()` で発行 |
| `roomId` | `roomId` | `roomId` | LiveKit room 識別子 |
| (server で生成、auth から) | `callerId` | `callerId` | 内部 user ID |
| `callerName` | `callerName` | `callerName` | 表示名 |
| `callerAvatarUrl` | `callerAvatarUrl` | `callerAvatarUrl` | nullable |
| `callerTrancallId` | `callerTrancallId` | `callerTrancallId` | `@username` |
| `roomType` | `roomType` | `roomType` | `audio` / `video` |
| `translationEnabled` | `translationEnabled` (boolean) | `translationEnabled` (`"true"`/`"false"`) | FCM data は文字列のみ |
| `languagePair` | `languagePair` | `languagePair` | `"ja-en"` 等 |
| `callerLanguage` | `callerLanguage` | `callerLanguage` | OutputLanguage |
| `issuedAt` (新規、Sprint 3 で追加) | `issuedAt` | `issuedAt` | schemas.ts v1.0 には未存在、Sprint 3 で v1.1 として追加。旧 `timestamp` (notification-detail.md v1.0) は v1.1 で廃止 |
| (server で生成、issuedAt + 30s) | `expiresAt` | `expiresAt` | TTL |
| (server で計算、§3 HMAC) | `signature` | `signature` | HMAC-SHA256 hex |

Sprint 3 で `IncomingCallNotificationSchema` を v1.1 フィールド集合に拡張する PR が `module-contracts.md` §2.5 注釈とともに発行される予定。

呼び出しシーケンス (canonical は `docs/call-lifecycle.md` §1):

```
caller → server (room.create)
   ↓
room facade → notification facade.sendIncomingCall(calleeId, payload)
   ↓
notification facade → apns adapter / fcm adapter (両方に並列送信、callee の登録 device 全てに)
   ↓
APNs / FCM → callee device
   ↓
PushKit / FCM service → CallBridge → CallKit / Telecom
```

### 6.5 Push 失敗時の fallback

**Phase 1a**: fallback なし。Push 失敗 = 着信不可。`notification facade.sendIncomingCall` は best-effort であり失敗を caller に伝えない (`call-lifecycle.md` §6 通り)。caller 側は ringing UI を ringtone 終了まで表示し、`onAbort` (callee 応答なし) で終話する。

**Phase 1b 検討項目**: アプリ前景時の WebSocket-based fallback (Supabase Realtime channel `incoming_calls:user_id` を subscribe し、Push 失敗時にも着信を表示)。Phase 1b 設計 PR で詳述予定。

---

## 7. React Native Native Module 仕様 (CallBridge JS API)

### 7.1 公開 TypeScript インタフェース

```ts
// apps/mobile/src/native/CallBridge.ts (Sprint 3 で実装)
import { z } from "zod";
import { OutputLanguage } from "@trancall/shared-kernel/schemas/language";  // 実 export 名
// IncomingCallPushPayload 型は Sprint 3 で packages/shared-kernel/src/schemas/native-call.ts に
// 配置予定 (§7.5)。以下のコード片の参照箇所では当該型を import する想定:
//   import type { IncomingCallPushPayload } from "@trancall/shared-kernel/schemas/native-call";

export const CallStateSchema = z.enum([
  "idle",
  "ringing",       // 着信受信、ユーザー応答待ち
  "answering",     // 応答ボタン押下後、room.connect 開始まで
  "connecting",    // room.connect 中、participant_joined 待ち
  "active",        // 通話中
  "ending",        // endCall 実行中
  "ended",
]);
export type CallState = z.infer<typeof CallStateSchema>;

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

export interface CallBridge {
  /** PushKit / FCM 登録、deviceToken を返す。アプリ起動時に必ず呼ぶ */
  registerForVoipPush(): Promise<{ token: string; platform: "ios" | "android" }>;

  /** 発信時、CallKit / Telecom に outgoing call を申告 */
  startOutgoingCall(args: {
    uuid: string;
    calleeName: string;
    roomId: string;
  }): Promise<void>;

  /** Push 受信を bridge 経由で OS 通話 UI に投入 (Phase 1a では bridge 内部で自動処理、JS 側からは通常不要) */
  reportIncomingCall(payload: IncomingCallPushPayload): Promise<void>;

  /** UI で応答ボタンが押された時 (CallKit/Telecom 経由で押された場合は自動で 'callAnswered' event が発火するためこの API は不要) */
  answerCall(uuid: string): Promise<void>;

  /** 終話 (RN UI の終話ボタン押下時) */
  endCall(uuid: string): Promise<void>;

  /** mute トグル */
  setMuted(uuid: string, muted: boolean): Promise<void>;

  /** スピーカーフォン切替 */
  setSpeakerphone(enabled: boolean): Promise<void>;

  /** 現在の call state を同期取得 (debug 用) */
  getCurrentCallState(): Promise<{ uuid: string; state: CallState } | null>;

  /** event 購読、unsubscribe 関数を返す */
  on<T extends CallEvent["type"]>(
    eventType: T,
    handler: (event: Extract<CallEvent, { type: T }>) => void,
  ): () => void;
}

// Expo Modules API では requireNativeModule を使う。autolinking 失敗時に明示的エラーになる
// (NativeModules.TranCallBridge は undefined のままで TypeScript 型エラーが出ない問題を回避)
import { requireNativeModule } from "expo-modules-core";
export const callBridge: CallBridge = requireNativeModule("TranCallBridge");
```

### 7.2 JS → Native 呼出規約

- 全ての関数は Promise を返し、Native 側 reject は `{ code: string; message: string }` 形式。
- `code` は `CALL_BRIDGE_*` 名前空間 (例: `CALL_BRIDGE_AUDIO_SESSION_FAILED`、`CALL_BRIDGE_CALL_NOT_FOUND`)。
- 失敗時は JS 側で Zustand state を巻き戻し、UI に toast 表示。
- 同時通話数は Phase 1a で 1 に制限。`startOutgoingCall` 中に再度 `startOutgoingCall` を呼ぶと `CALL_BRIDGE_BUSY` を reject。

### 7.3 Native → JS event 配信

- `NativeEventEmitter` (Expo Modules `EventEmitter`) で配信。
- 全 event payload を Zod `safeParse` してから Zustand に反映 (失敗時は log のみ、UI 状態は変更しない)。
- subscribe は React component の `useEffect` で行い、return で必ず unsubscribe する。

### 7.4 source of truth

OS の CallKit / Telecom が **真の call state** の所有者。JS Zustand `CallStore` は **ミラー** であり、Native event を受けて受動的に更新される。

矛盾時 (例: JS が `active` のまま Native は `ended`) は **Native 優先**。次のいずれかで再同期:
- `getCurrentCallState()` を定期 (5s 間隔) で呼び比較
- アプリ前景復帰時 (`AppState.change → 'active'`) に `getCurrentCallState()` を実行

### 7.5 Type 定義の単一ソース

`packages/shared-kernel/src/schemas/native-call.ts` (Sprint 3 で新規作成) に `CallStateSchema` / `CallEventSchema` / `IncomingCallPushPayloadSchema` を集約し、`apps/mobile` と `packages/notification` の両方から import する。実装と本書の乖離を防ぐため、Sprint 3 着手時に本書 §6.3 §7.1 のスキーマ定義をそのままコピーして配置する。

---

## 8. 状態遷移と source of truth

### 8.1 Call State Machine

```
       ┌──────────┐
       │   idle   │
       └────┬─────┘
            │ startOutgoingCall (caller) / incomingCall event (callee)
            ▼
       ┌──────────┐                  ┌──────────┐
       │  ringing │ ──── timeout ──▶ │  ended   │ (reason: timeout)
       └────┬─────┘                  └──────────┘
            │ answer
            ▼
       ┌────────────┐
       │ answering  │
       └────┬───────┘
            │ room.connect 成功
            ▼
       ┌─────────────┐
       │ connecting  │
       └────┬────────┘
            │ participant_joined event
            ▼
       ┌──────────┐                  ┌──────────┐
       │  active  │ ──── error ────▶ │  ended   │ (reason: failed)
       └────┬─────┘                  └──────────┘
            │ endCall (user / remote)
            ▼
       ┌──────────┐
       │ ending   │
       └────┬─────┘
            │ room.disconnect 完了 + Native cleanup 完了
            ▼
       ┌──────────┐
       │  ended   │
       └──────────┘
```

### 8.2 Native event ⇄ JS state ⇄ LiveKit state 対応表

| Phase | Native event | JS CallStore state | LiveKit Room state | Server side |
|---|---|---|---|---|
| 着信受信 | `incomingCall` | `ringing` | (未接続) | (未操作) |
| 応答 | `callAnswered` | `answering` | (未接続) | POST /rooms/:id/join |
| Token 取得 | (なし) | `connecting` | `connecting` | (Server 経由で完了) |
| Room 接続成功 | (なし) | `active` | `connected` | participant_joined event |
| 通話中 mute | `callMuted` | (mute flag のみ更新) | `localAudioTrack.setEnabled` | (なし) |
| 通話中 audio 切替 | `audioRouteChanged` | (audio route のみ更新) | (LiveKit SDK 側追従) | (なし) |
| 終話 (自分) | `callEnded { reason: 'user' }` | `ending → ended` | `disconnected` | POST /rooms/:id/leave |
| 終話 (相手切断) | `callEnded { reason: 'remote' }` | `ending → ended` | `disconnected` | (Agent / 相手側から既に leave 済) |
| 強制終了 | `callEnded { reason: 'force_terminated' }` | `ended` | (切断済) | best-effort POST leave |

### 8.3 異常系遷移

- **`ringing` のままユーザー無応答 30 秒**: CallKit / Telecom 側で自動的に missed call 扱い。`callEnded { reason: 'timeout' }` が emit。Server 側は別経路 (caller 側の `endCall` または `expiresAt` 経過) で room を ended にする。
- **`connecting` で token expired (HTTP 401)**: JS が `endCall(uuid)` を呼び `callEnded { reason: 'failed' }` で終了、UI に「接続に失敗しました」を表示。
- **`active` で network 切断**: LiveKit SDK が自動再接続を試行 (default 30s)。再接続不可なら LiveKit `disconnected` event → JS が `endCall(uuid)`。

---

## 9. 失敗ケースと OS 固有制約

### 9.1 iOS PushKit / CallKit 制約

| 制約 | 内容 | 対応 |
|---|---|---|
| **5 秒以内 reportNewIncomingCall** | iOS 13+ で厳格化、超過時アプリ kill + 以降の VoIP push 受信権限剥奪 | §4.3 の `pushRegistry(_:didReceiveIncomingPushWith:for:completion:)` 内で **何も同期処理を入れず、即 reportNewIncomingCall + completion()** |
| **completion() 必須** | Apple doc: 「pushRegistry の completion を呼ばないと OS が異常状態とみなす」 | error path でも必ず completion() を呼ぶ |
| **payload 5KB 制限** | APNs VoIP は 5KB まで (通常 push 4KB より大きい) | `signature` 含めて 1KB 程度に収まるため余裕 |
| **CallKit 中国本土無効** | 中国本土 (Apple ID region = CN) では CallKit が無効化されている | §10.2 で fallback 設計、Phase 1a スコープ外 |
| **PushKit deprecation 噂** | iOS 13 当時 deprecation 計画があったが iOS 17 でも維持。Apple は撤回を発表せず | §14.1 リスクとして継続監視 |

### 9.2 Android Telecom 制約

| 制約 | 内容 | 対応 |
|---|---|---|
| **ForegroundService 5 秒以内 startForeground** | Android 12+、特に 14+ で `ForegroundServiceDidNotStartInTimeException` で死ぬ | §5.4 で `addNewIncomingCall` 直後に `startForegroundService` 呼出 |
| **FOREGROUND_SERVICE_PHONE_CALL permission** | Android 14+ で必須、未付与で `SecurityException` | §5.1 manifest に明記 |
| **Doze / App Standby** | Doze 中は通常 service 起動不可、FCM high_priority data でのみ突破可能 | §6.2 で `priority: "high"` 必須 |
| **メーカー独自最適化** | Xiaomi / Huawei / Oppo / Vivo は独自の battery optimization で kill されるケースあり | §11.3 実機テストで確認、Phase 1b で工場別 setup ガイド整備 |
| **POST_NOTIFICATIONS** | Android 13+ で runtime 取得必須。未取得時は CallKit 風 UI が出ない場合あり | アプリ起動時に runtime 要求 |

### 9.3 Audio session 競合

- **iOS**: 他アプリの CallKit (普通の電話、Skype、LINE 等) と同時着信時、CallKit システムが arbitrate。一方が active なら他方は `CXErrorCodeIncomingCallError.callUUIDAlreadyExists` で reject される。bridge は reject を黙殺し completion() を呼ぶ。
- **Android**: 同様に Telecom が arbitrate。`onCreateIncomingConnectionFailed` が呼ばれるので best-effort で log。

### 9.4 LiveKit room connect 失敗

| エラー | 原因 | bridge 動作 |
|---|---|---|
| Token invalid (4xx) | server token 発行ミス、TTL 切れ | JS が `endCall(uuid)`、`callEnded { reason: 'failed' }` |
| Network timeout | 通信不可 | LiveKit SDK 内部で 30s リトライ後 `disconnected` event、JS が `endCall(uuid)` |
| LiveKit Cloud 障害 (5xx) | LiveKit サービス側障害 | 同上、UI に「翻訳サービスに接続できません」表示 |

---

## 10. Phase 1a スコープ vs Phase 1b 以降 (deferred)

### 10.1 Phase 1a (Sprint 3 必須)

- 前景アプリ着信 / 応答 / 終話 (iOS / Android)
- Lock screen 着信 (iOS / Android)
- killed-state 着信 (iOS PushKit / Android FCM data + Foreground Service)
- AudioSession / AudioManager の通話モード切替
- mute / speakerphone トグル
- 終話 (両方向)
- LiveKit Room との連携 (token 取得 / connect / disconnect)
- VoIP Push payload Zod 検証
- bridge → JS event の Zustand 反映
- 同時通話数 1 (`maximumCallGroups = 1`)

### 10.2 Phase 1b 以降 (deferred)

| 項目 | 理由 | 想定 Sprint |
|---|---|---|
| Hold / Resume (CXSetHeldCallAction / Connection.onHold) | 他通話と同時保持の複雑性、Phase 1a は他通話着信時に終話で割り切る | Phase 1b |
| 複数同時通話 (`maximumCallGroups >= 2`) | 同時通話 UI 設計と LiveKit 多 Room 切替の検証必要 | Phase 1c |
| iOS Recents 統合の Caller 拡張 (Apple Contacts 連携) | `INStartCallIntent` 対応、Apple 純正連絡先 + Siri 統合 | Phase 1c |
| Android 純正 dialer 統合 (Self-Managed → Managed 移行検討) | アプリ独自 UI の方が翻訳機能訴求しやすい、Managed 化は要件次第 | 未定 |
| Mainland China (Apple ID = CN) fallback | 通常 push + アプリ前景時のみ着信、別 build target が必要 | Phase 1c 以降 |
| Background WebSocket fallback (Supabase Realtime) | Push 失敗時の救済、運用データ蓄積後に検討 | Phase 1b |
| Picture-in-Picture (Phase 2 video 通話用) | 音声のみの Phase 1 ではスコープ外 | Phase 2 |
| Carrier 名表示 (CXProviderConfiguration.localizedName) | 翻訳通話アプリでは不要 | 不採用 |

---

## 11. テスト戦略

### 11.1 Native unit test

| 対象 | フレームワーク | 範囲 |
|---|---|---|
| iOS Swift | XCTest | `CXProviderDelegate` のハンドラが正しい event を bridge に emit するか、`reportNewIncomingCall` の呼出引数が正しいか |
| Android Kotlin | JUnit + Robolectric | `Connection` 派生クラスの状態遷移、`AudioManager` mode の正しい切替 |

### 11.2 JS unit test

`apps/mobile/src/native/__tests__/call-bridge.test.ts` で Native Module を mock し、event 配信 + Zustand 反映 + Zod 検証を vitest で確認。

### 11.3 実機 E2E test

| シナリオ | iOS 端末 | Android 端末 | 自動化 |
|---|---|---|---|
| 前景着信 | iPhone 14 / iOS 17 | Pixel 8 / Android 14 | Maestro flow (Phase 1a 終盤) |
| Lock screen 着信 | 同上 | 同上 | 手動 (Maestro Lock 制限) |
| killed 着信 | 同上 | 同上 + Xiaomi Redmi Note 13 / MIUI 14 | 手動 |
| 通話中 home 押下 | 同上 | 同上 | Maestro |
| 通話中 Bluetooth 切替 | iPhone + AirPods | Pixel + Pixel Buds | 手動 |
| 同時着信 (普通電話) | iPhone + 普通の電話発信 | Pixel + 普通の電話発信 | 手動 |

### 11.4 シミュレータ / エミュレータ制約

- **iOS Simulator**: PushKit registration 不可 (deviceToken 取得不可)、CallKit UI は表示されるが LiveKit RTP も含めて動作確認は実機必須。
- **Android Emulator**: Telecom Framework は動くが ForegroundService 通知制約緩い、メーカー独自最適化は再現不可。実機テスト必須。

### 11.5 CI 統合

- Native unit test は GitHub Actions の macOS runner (iOS) + Linux runner (Android) で実行。
- 実機 E2E は Sprint 3 で Bitrise / EAS Build + 実機ラボ (例: BrowserStack App Live) を検討。Phase 1a 完了判定には手動実機チェック必須。

### 11.6 Phase 1a 完了 Gate Check (Sprint 3 終盤に実施)

Phase 1a を「完了」と宣言できる条件を以下に明示する。Sprint 3 終盤に下記すべてが PASS で合意できた場合のみ完了。1 項目でも未達なら Phase 1b 着手前に修正必須。

**実機シナリオ (§11.3 と同じ端末セットを使用)**

| # | シナリオ | iOS | Android (Pixel) | Android (Xiaomi/Huawei) | 合否記録 |
|---|---|---|---|---|---|
| G-1 | 前景着信 → 応答 → 30s 通話 → 自分終話 | ☐ | ☐ | ☐ | |
| G-2 | Lock screen 着信 → 応答 → 30s 通話 → 相手終話 | ☐ | ☐ | ☐ | |
| G-3 | アプリ killed 着信 → 応答 → 30s 通話 → 自分終話 | ☐ | ☐ | ☐ | |
| G-4 | 着信無応答 (30s) → missed call 確認 | ☐ | ☐ | ☐ | |
| G-5 | 通話中 home → 30s 後復帰 → 通話継続 | ☐ | ☐ | ☐ | |
| G-6 | 通話中 Bluetooth ヘッドセット切替 → 音声経路追従 | ☐ (AirPods) | ☐ (Pixel Buds) | (任意) | |
| G-7 | 通話中 mute → unmute (CallKit/Telecom UI 経由) | ☐ | ☐ | ☐ | |
| G-8 | 通話中 speakerphone トグル | ☐ | ☐ | ☐ | |
| G-9 | 同時着信 (普通電話) → CallKit/Telecom 競合解決 | ☐ | ☐ | (任意) | |

**負テスト (Native unit test + 手動)**

| # | テスト | 合否 |
|---|---|---|
| N-1 | HMAC signature 不正 payload を投入し CallKit/Telecom に何も投入されないことを log で確認 | ☐ |
| N-2 | `expiresAt` 超過 payload を投入し黙殺されることを log で確認 | ☐ |
| N-3 | `trancall` キー欠落 payload を投入し safeParse 失敗で破棄されることを確認 | ☐ |
| N-4 | iOS 5 秒 rule: `reportNewIncomingCall` を遅延させてアプリが kill されることを実機で再現 (1 回確認すれば以降は禁止) | ☐ |
| N-5 | Android 14: `FOREGROUND_SERVICE_PHONE_CALL` permission 未付与時に `SecurityException` が起きることを確認 | ☐ |

**実装品質 Gate**

| # | 項目 | 合否 |
|---|---|---|
| Q-1 | Native unit test (XCTest / JUnit) が 2 連続 PASS (modular-verification-loop 方針) | ☐ |
| Q-2 | JS bridge unit test (vitest) が 2 連続 PASS | ☐ |
| Q-3 | `notification-detail.md` v1.3 と本書 v1.x の field 集合が同期、CI 互換性 test PASS | ☐ |
| Q-4 | `eslint` `tsc` warning ゼロ | ☐ |

**禁止条件**: 実機未確認のまま Phase 1a 完了宣言は不可 (シミュレータ・エミュレータのみでの確認は Phase 1a 終了に不十分)。Xiaomi/Huawei 端末で確認できなかった場合は「Xiaomi/Huawei は Phase 1b 課題」と明示記録すれば Phase 1a 完了は可。

---

## 12. セキュリティ

### 12.1 VoIP Push payload 検証

HMAC 署名仕様の **canonical は `docs/notification-detail.md` §3**。本書では bridge 側の検証順序を補強する。

- 共有鍵 `TRANCALL_PUSH_HMAC_SECRET` (32 文字以上) は Server / Mobile bridge の両方に配布:
  - **Server**: Render Background Worker の env vars に直接設定 (`docs/deployment-render-dryrun.md` §3 secrets 配布手順)
  - **Mobile**: EAS Build の `eas.json` `extra` で参照する **EAS Secrets** (`EXPO_PUBLIC_*` ではなく非公開 secret として登録) 経由でビルド時注入。アプリ起動時に `expo-secure-store` に書き込んで encrypted at rest 保管。EAS Secrets への登録は `eas secret:create --scope project --name TRANCALL_PUSH_HMAC_SECRET --value <secret>` で行う (Sprint 3 で運用 runbook を `docs/deployment-render-dryrun.md` 改訂時に追記予定)
- canonical string: `type|uuid|roomId|callerId|callerTrancallId|issuedAt|expiresAt` (`notification-detail.md` §3.2)。**表示用フィールド (`callerName`, `callerAvatarUrl`, `languagePair`, `callerLanguage`, `roomType`, `translationEnabled`) は署名対象外**。
- 計算式: `HMAC-SHA256(secret, canonical).hexdigest()` (64 文字 lowercase hex)。実装例 (Swift CryptoKit / Kotlin javax.crypto / Node.js crypto) は `notification-detail.md` §3.3。

**Mobile bridge 検証順序**:
1. `payload.dictionaryPayload["trancall"]` (iOS) または `remoteMessage.data` (Android) を取得
2. Codable / kotlinx.serialization で構造体にデコード (schema 不一致は破棄)
3. `expiresAt` を現在時刻と比較、超過なら破棄
4. canonical string を §3.2 順序で組み立て
5. constant-time 比較で `signature` と比較。**Swift は `HMAC<SHA256>.isValidAuthenticationCode(_:authenticating:using:)` を使う** (CryptoKit が constant-time 比較を内部実装、手動の `==` / byte ループは short-circuit リスクあり)。**Kotlin は `java.security.MessageDigest.isEqual(byte[], byte[])`** (Java 6 以降で constant-time 保証)
6. 不一致なら **CallKit / Telecom に何も投入せず**、log only で破棄
7. すべて OK なら `CXProvider.reportNewIncomingCall` / `TelecomManager.addNewIncomingCall` を呼ぶ

**HMAC 鍵 rotation**: `TRANCALL_PUSH_HMAC_SECRET_NEXT` を併走で発行、Mobile bridge は 24h 期間中、新旧両方の鍵で signature を試行 (古い鍵が一致したら log 警告)、24h 経過後に新鍵単独に切替。詳細は `docs/security-detail.md` HMAC rotation 節および `notification-detail.md` §3.1。

### 12.2 CallKit / Telecom UI の callerName スプーフィング対策

- `callerName` は server 側で発行し HMAC 署名込み payload に含める。Mobile bridge は signature 検証 OK の payload のみ CallKit / Telecom UI に表示。
- 攻撃者が偽 push を送ったとしても HMAC が一致しないため CallKit には到達しない。

### 12.3 LiveKit token grant

- Push payload には **LiveKit token を含めない** (push が中継キャッシュ等で stale 化するリスク回避)。
- Mobile は CallKit answer → server に `POST /rooms/:id/join` で fresh token を取得して `room.connect`。
- token TTL は 5 分 (`media facade.issueAccessToken` の defaultTTL)、再発行で stale 防止。

### 12.4 PII 取扱

- Push payload の `callerName` は表示名のみ (`@trancall_id` ではメアド等の PII 露出なし)。
- 通話履歴 (CallKit Recents) は OS に残るが、`callerName` のみ表示。電話番号フィールドは空。
- ログには `callerId` (内部 UUID) のみ、`callerName` は出さない。

---

## 13. 実装移行手順 (Sprint 3 着手時)

### 13.1 Phase 1a 実装順序

```
Step 1: Expo Module skeleton 作成
  - apps/mobile/modules/call-bridge/ ディレクトリ構成
  - expo-modules-autolinking で iOS/Android 自動構成
  - JS から空メソッドを呼べる状態に

Step 2: iOS native 実装
  - CallBridgeProvider.swift (CXProvider + CXProviderDelegate)
  - PushKitDelegate.swift (PKPushRegistry)
  - entitlement / Info.plist 反映
  - シミュレータで CallKit UI 表示確認 (PushKit 以外)

Step 3: Android native 実装
  - CallConnectionService.kt + TranCallConnection.kt
  - CallForegroundService.kt
  - TranCallFirebaseMessagingService.kt
  - PhoneAccount 登録
  - AndroidManifest 反映
  - Pixel emulator で着信 UI 表示確認

Step 4: JS bridge 実装
  - apps/mobile/src/native/CallBridge.ts (TypeScript wrapper)
  - Zod schema 配置 (packages/shared-kernel/src/schemas/native-call.ts)
  - Zustand CallStore 連携
  - useEffect での event subscribe pattern を screens に展開

Step 5: LiveKit 連携
  - callBridge event 'callAnswered' → apiClient.post('/rooms/:id/join') → room.connect
  - LiveKit AudioSession.configureAudio で CallKit / Telecom と協調
  - mute / speakerphone を双方向 (RN UI ↔ CallKit/Telecom UI) 同期

Step 6: 実機 E2E
  - iPhone + Android 実機で前景 / Lock / killed を一周
  - Maestro flow に整理、CI 連携検討
```

### 13.2 Apple Developer Account 準備

| 手順 | 担当 | 備考 |
|---|---|---|
| App ID に `Push Notifications` capability 追加 | iOS lead | Apple Developer Console |
| APNs auth key (`*.p8`) 1 本発行 (`*.p12` Certificate は採用しない、§2.2.1 参照) | 同上 | Apple Developer Console → Keys |
| 鍵を 1Password vault `TranCall / Production / APNs` に保管 | 同上 | `docs/deployment-render-dryrun.md` §2.3 1Password 構造に従う |
| Provisioning profile 再作成 (新 entitlement 反映) | 同上 | EAS Build / fastlane で自動化候補 |
| TestFlight build に VoIP entitlement が反映されていることを確認 | QA | aps-environment = production の確認 |

### 13.3 Google Play / Firebase 準備

| 手順 | 担当 | 備考 |
|---|---|---|
| Firebase プロジェクト作成、Android アプリ追加 | Android lead | sender_id / Server Key 取得 |
| `google-services.json` を `apps/mobile/android/app/` に配置 (gitignore 対象、1Password 配布) | 同上 | 1Password vault `TranCall / Production / Firebase` |
| Play Console で Foreground Service 用途宣言 (`PHONE_CALL`) | 同上 | Android 14 以降必須 |
| Sensitive permissions 申告 (`MANAGE_OWN_CALLS` は通常審査不要、`POST_NOTIFICATIONS` も通常不要) | 同上 | 念のため事前確認 |
| 内部テスト trackで実機配信、Xiaomi/Huawei 系での動作確認 | QA | メーカー独自最適化を優先確認 |

### 13.4 dev / staging / prod 環境分離

現状 `apps/mobile/app.json` は単一 bundle ID `tech.hori.trancall` で運用。Sprint 3 で env-specific bundle ID を導入する場合は以下の構成を想定 (Phase 1a 終盤の判断):

| 環境 | APNs | FCM | bundle ID (案) | LiveKit |
|---|---|---|---|---|
| dev | development gateway | dev project | `tech.hori.trancall.dev` | LiveKit Cloud staging |
| staging | production gateway (TestFlight / Internal) | staging project | `tech.hori.trancall.staging` | LiveKit Cloud staging |
| prod | production gateway (App Store / Play Store) | prod project | `tech.hori.trancall` | LiveKit Cloud production |

env-specific bundle ID を採用しない場合は Apple Developer Console / Firebase Console 上で provisioning profile / `google-services.json` を環境別に切替える運用とし、bundle ID は `tech.hori.trancall` 単一とする (EAS Build profile で切替)。Sprint 3 着手時にチーム判断。

### 13.5 Sprint 3 リスク

| リスク | 影響 | Mitigation |
|---|---|---|
| Apple App Review で CallKit 不適切利用判定 | リジェクト、再申請で 1-2 週間ロス | 通話以外で CallKit を絶対使わない、レビュー文書に「VoIP 翻訳通話アプリ」と明記、初版 build で TestFlight 内部レビュー |
| Android 14 ForegroundService 不適切タイプで kill | 着信機能完全死亡 | §5.5 の `FOREGROUND_SERVICE_TYPE_PHONE_CALL` 厳守、Android 14 実機で Phase 1a 終盤に必ず確認 |
| Mainland China CallKit 無効化 | 中国本土ユーザーで着信不可 | Phase 1a スコープ外と割り切り、Phase 1c で別 build target 検討 (§10.2 deferred) |
| PKPushRegistry deprecation アナウンス | 突発的に新方式移行コスト | §14.1 で監視、Apple WWDC 動画 + Apple Developer News 月次チェック |

---

## 14. 既知のリスク

| # | リスク | 影響度 | 発生確率 | Mitigation |
|---|---|---|---|---|
| 1 | iOS PKPushRegistry deprecation アナウンス | High | Low | 月次で Apple Developer News 確認、新方式 (PushKit 後継候補) が出たら別 PR で抽象化レイヤを追加 |
| 2 | Android 14 FOREGROUND_SERVICE_PHONE_CALL 厳格化 (15 で更に厳格化の可能性) | High | Medium | manifest と code を Android 14 で最新運用、Android 15 ベータで先行検証 |
| 3 | Mainland China での CallKit 無効化 | Medium (中国本土ユーザーのみ) | High (政治的に解除されない) | Phase 1c で region 検出 + 通常 push fallback の別 build target |
| 4 | RN New Architecture (Bridgeless Mode) 必須化 | Medium | Medium (Expo SDK 56 で予定) | Expo Modules API 採用済のため移行コストは中程度。Phase 1b でアップグレード PR を計画 |
| 5 | LiveKit RN SDK の AudioSession 干渉 | Medium | Low | §4.7 で `AudioSession.configureAudio` を CallKit `didActivate` 後に呼ぶ順序を厳守、SDK バージョン上げる時は実機 echo cancellation テスト必須 |
| 6 | Xiaomi / Huawei 系のバックグラウンド最適化で着信不可 | High (メーカー別ユーザーのみ) | Medium | Phase 1a 終盤に実機確認、Phase 1b でメーカー別 setup ガイドをアプリ内に表示 |
| 7 | APNs / FCM 配信遅延 (10 秒以上) | Medium | Low (通常運用 1s 以内) | 着信側 ringing UI を 30 秒で timeout、caller には missed call 通知 |
| 8 | App Review で「ringtone は OS 標準を使うべき」と指摘 | Low | Low | カスタム ringtone を採用しない (`config.ringtoneSound = nil`)、OS 標準着信音を使用 |
| 9 | HMAC 共有鍵漏洩 → 偽着信 push 攻撃 | High | Low | Mitigation: `TRANCALL_PUSH_HMAC_SECRET` を 1Password 管理、漏洩時 24h dual-accept で rotation。Mobile 側で `expiresAt` 検証も併用 |

---

## 15. 改訂履歴

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2026-05-12 | Sprint 2 D4 設計書 初版。Scope: iOS CallKit + PushKit / Android Telecom + ConnectionService / VoIP Push 設計 / RN Native Module 仕様 / 状態遷移 / OS 制約 / Phase 1a スコープ / テスト戦略 / セキュリティ / Sprint 3 移行手順 / リスク。canonical 階層: architecture.md (システム全体) → call-lifecycle.md (シーケンス) → 本書 (native bridge 詳細) → packages/shared-kernel schema (Sprint 3 で追加)。 |
| v1.1 | 2026-05-12 | Round 1 レビュー指摘 Critical 4 + Major 4-5 + Minor 5-7 を反映。主な変更: (1) §6.1 / §6.2 APNs/FCM payload を `notification-detail.md` v1.1 の nested 構造 (`{aps:{}, trancall:{...}}`) に整合、独立した IncomingCallPushPayloadSchema 定義は削除し canonical を notification-detail.md に一本化、(2) §6.2 FCM payload を HTTP v1 API (`message.token`/`message.data`/`message.android`) に修正 (Legacy v0 は 2024-06 廃止済)、(3) §4.3 Swift コードを `payload.dictionaryPayload["trancall"]` から読み出す nested 対応に修正、(4) §6.3 schema 配置を `packages/notification/src/schemas.ts` への拡張に一元化、(5) §3.2.2 ステップ 6 の「didActivate で room.connect」を「Native は AudioSession 設定のみ、room.connect は JS」に修正、(6) §3.2.2 Android `ForegroundServiceDidNotStartInTimeException` を Android 12+ に訂正 (旧記述 Android 14+ は誤り)、(7) §4.4 / §4.7 AudioSession options に `allowBluetooth` (HFP マイク) を追加、(8) §4.1 entitlement から `com.apple.developer.usernotifications.communication` を削除 (App Review リジェクト誘発)、(9) §4.5 着信フロー図から `reportOutgoingCall` 行を削除 (発信側専用 API、着信応答で呼ぶと CallKit エラー)、(10) §4.2 `ringtoneSound = nil` に修正 (§14 #8 と整合)、(11) §11.6 Phase 1a 完了 Gate Check 節を新設 (実機 9 + 負テスト 5 + 実装品質 4)、(12) §12.1 HMAC 検証順序を 7 ステップに具体化、canonical string は `notification-detail.md` §3.2 参照、(13) §2.1 Telecom Framework 導入 API を 23 から 21 に訂正、(14) §2.2.1 VoIP Services Certificate と p8 の二重記述を整理 (p8 のみ採用)、(15) §5.1 MANAGE_OWN_CALLS の runtime request 記述を削除 (normal permission のため不可)、(16) §5.2 `CAPABILITY_VIDEO_CALLING` を Phase 1a から除去 (Phase 2 で追加)、(17) §7.1 `OutputLanguageSchema` を `OutputLanguage` に修正 (実 export 名)、(18) §7.1 callBridge 初期化を `requireNativeModule` に修正 (autolinking 失敗時の明示的エラー)、(19) §13.4 bundle ID 例示を `tech.hori.trancall` に修正 (app.json 現状)、(20) §5.2 クラスファイル名コメントを `TranCallApplication.kt` に修正、(21) §4.3 PKPushRegistry queue 解説を追加。同時に `docs/notification-detail.md` を v1.1 に更新し HMAC 仕様 §3 を新設、payload に `uuid` / `callerId` / `issuedAt` / `expiresAt` / `signature` フィールドを追加 (notification-detail.md は本書 v1.3 と同時に Round 3 で v1.2 → v1.3 へ更新済)。 |
| v1.2 | 2026-05-12 | Round 2 レビュー指摘 Warning 3 + Suggestion 2 を反映。(W-1, A+C 両方指摘) §12.1 / notification-detail.md §3.3 §3.4 の Swift constant-time 比較を `HMAC<SHA256>.isValidAuthenticationCode(_:authenticating:using:)` 使用に修正 (CryptoKit が内部 constant-time 保証、`Data` の `==` や手動ループは short-circuit リスクあり)。Kotlin は `MessageDigest.isEqual` (Java 6 以降 constant-time 保証) を明示。(W-2) §6.4 フィールド対応表のヘッダを `APNs "aps.trancall.*"` から `APNs "trancall.*" (top-level trancall キー配下)` に修正。(W-3) §7.1 コードブロック冒頭に `IncomingCallPushPayload` 型の import 想定コメントを追加 (Sprint 3 で `packages/shared-kernel/src/schemas/native-call.ts` に配置予定)。(B Suggestion) §6.4 の `timestamp (deprecated) → issuedAt` 表記を `issuedAt (新規、Sprint 3 で追加)` 単独行に整理。(C S-1) §12.1 に Mobile bridge への HMAC 鍵配布経路を明記 (EAS Secrets 経由でビルド時注入 → `expo-secure-store`)。(C S-2) §4.3 PKPushRegistry queue コメントを強化 (Sprint 3 では専用 serial queue を強く推奨)。 |
| v1.3 | 2026-05-12 | Round 3 レビュー指摘 Minor 4 件を反映。(A Suggestion) notification-detail.md §1.1 ステップ 4 の `authenticationCode` を `isValidAuthenticationCode` に統一 (検証側の API 名)。(B Warning) 本書冒頭メタ表および §6.3 / §6.4 / §12.1 / §11.6 Q-3 等の `notification-detail.md v1.1` 参照を `v1.2` に更新。(B Suggestion) notification-detail.md §3.3 Kotlin 行に `MessageDigest.isEqual` による検証コード例を追記 (Swift 行との対称性確保)。(C Warning) §13.2 表の "VoIP Services Certificate (`*.p12`) または APNs auth key (`*.p8`)" 並列記述を `APNs auth key (*.p8) 1 本発行 (§2.2.1 参照、*.p12 は採用しない)` に修正 (§2.2.1 / §4.1 と整合)。Status: 本書 Draft v1.3、notification-detail.md v1.3 に同期。 |
| v1.4 | 2026-05-12 | Round 5 B Warning を反映。本書本文の `notification-detail.md` バージョン参照 5 箇所 (冒頭メタ表 / §6.3 / §6.4 / §11.6 Gate Q-3 / 改訂履歴の本文記述) を `v1.2` → `v1.3` に同期更新し、Round 3 の改訂履歴「v1.3 に同期」宣言と本文の自己矛盾を解消。改訂履歴 v1.1〜v1.3 の歴史的記述 (各 Round 時点でのバージョン参照) は事実関係保持のため変更しない。 |
