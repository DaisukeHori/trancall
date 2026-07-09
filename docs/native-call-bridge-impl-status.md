# Native Call Bridge 実装状況 (#68 Stage 1/2)

| 項目 | 内容 |
|------|------|
| 上位設計 | `docs/native-call-bridge.md` (canonical) |
| 対応 Issue | #54 #56 #30 #68 #32 #33 (Stage 1) / #68 #32 (Stage 2) |
| 作業ブランチ | `w3/mobile-native` |
| 対象範囲 | `apps/mobile/`, `packages/ui-kit/` のみ (`server/`, 他 `packages/*` は変更していない) |
| 最重要の前提 | **この環境では Xcode / Android Studio によるネイティブビルド・実機/シミュレータ検証が一切できない。** 以下の Swift/Kotlin 実装は全て「型・構造としては妥当だが未コンパイル・未実行」のスキャフォールドである。各ファイル冒頭に `⚠️ device-verification-required` コメントを付与済み。 |

---

## 1. 検証方法の正直な区分

| 検証方法 | 対象 | 実施状況 |
|---|---|---|
| `tsc --noEmit` (typecheck) | TS/TSX 全ファイル (`modules/call-bridge` 含む) | ✅ 実施・green |
| `vitest run` (単体テスト) | TS ロジック (permissions, incoming-call-push, hmac-validator 等) | ✅ 実施・green (542 tests / 36 files) |
| `npx expo config --json` | app.json + config plugins の静的解決 | ✅ 実施・green |
| `npx expo-modules-autolinking search/resolve` | Expo Module (call-bridge) の autolinking 発見・podspec/gradle 解決 | ✅ 実施・green (iOS podspec 発見、Android gradle module 発見を実測確認) |
| Xcode ビルド (`pod install` / コンパイル) | iOS native (`ios/CallBridge/*.swift`, `modules/call-bridge/ios/*.swift`) | ❌ **未実施** (Xcode 無し) |
| Android Studio / Gradle ビルド | Android native (`modules/call-bridge/android/**/*.kt`) | ❌ **未実施** (Android Studio 無し) |
| 実機/シミュレータ動作確認 (着信/発信/mute/speaker 等) | 全体フロー | ❌ **未実施** |

`expo-modules-autolinking resolve --platform ios/android` は実際に以下を返すことを確認済み (2026-07-09 実測):

```
iOS:     podName "CallBridge", swiftModuleNames ["CallBridge"], modules ["CallBridgeModule"]
Android: sourceDir ".../modules/call-bridge/android", modules ["tech.hori.trancall.callbridge.CallBridgeModule"]
```

これは「ファイルが正しい場所に配置され、Expo のモジュール発見機構が正しく認識する」ことの実証であり、**Xcode/Gradle による実コンパイルの保証ではない**。

---

## 2. Stage 1 (検証可能・確実に緑化) — 完了

| # | 項目 | 状態 | 詳細 |
|---|---|---|---|
| #54 | Expo SDK54 版整合 | ✅ 完了 | RN 0.81.5 / React 19.1.0 / expo-* 全て SDK54 世代に統一。`expo-file-system` v19 の legacy API 移動 (`expo-file-system/legacy`) に追従。`pnpm turbo typecheck` 全16パッケージ green (他パッケージへの影響なし)。 |
| #56 | Config Plugin 化 | ✅ 完了 (Stage 2 で一部再設計) | 下記§3参照 |
| #30/#68 | 通話ナビゲーション配線 | ✅ 完了 (TS) | RootStack に `CallStack` を `fullScreenModal` で兄弟 screen としてマウント。`rootNavigationRef` (React tree 外からもナビゲート可) 経由で contact-profile-screen の発信ボタン・VoIP push リスナーの両方から到達可能。 |
| #32 | 権限要求フロー | ✅ 完了 (TS) | `expo-audio` (マイク) / `expo-notifications` (通知) の runtime 権限要求を実装、orphan だった `permission-*-screen.tsx` を `permission-store` 経由の Modal で実フローに接続。`connect.ts` の `setMicrophoneEnabled(true)` 前に権限確認 (`MicrophonePermissionDeniedError`)。 |
| #33 | 残アイコン | ✅ 完了 | in-call/calling の「X」、oss-licenses/settings の「›」、signup/consent の「✓」を `@expo/vector-icons` (Ionicons) 化。色/hex ハードコード監査済み (screens/components 配下に残存なし)。 |
| FCM/EAS 前提設定 | app.json/eas.json placeholder | ✅ 完了 (placeholder) | 下記§6参照 |

---

## 3. iOS Config Plugin (`plugins/with-ios-callbridge.js`)

| 対象 | 実装方式 | 状態 |
|---|---|---|
| Info.plist `UIBackgroundModes: [voip, audio]` | `withInfoPlist` (Expo 標準 mod) + app.json `ios.infoPlist` 直接宣言の二重保証 | ✅ 実装済 (mod 解決を `expo config --json` で確認済み) |
| Entitlements `aps-environment` | `withEntitlementsPlist` (Expo 標準 mod) + app.json `ios.entitlements` | ✅ 実装済 |
| `PrivacyInfo.xcprivacy` | ~~個別ファイルコピー~~ → app.json `ios.privacyManifests` (Expo 標準 `withPrivacyInfo` mod、`withDefaultPlugins` に組み込み済み) に一本化。**Stage 1 当初は `withDangerousMod` でのファイルコピーを予定していたが、Expo 公式のより堅牢な仕組みが既存すると判明したため設計変更**。 | ✅ 実装済 |
| `ios/CallBridge/HmacValidator.swift` | `withDangerousMod("ios")` で `plugins/templates/ios/CallBridge/` からコピー | ✅ ファイル配置のみ実装 (Xcode プロジェクト = pbxproj への Compile Sources 登録は**未実装**、下記§7参照) |
| `ios/CallBridge/PushKitDelegate.swift` | 同上。#H-3 対応で `CallBridgeModule.emitDeviceToken`/`emitIncomingCall` を呼ぶよう更新 | ✅ 同上 |
| `ios/CallBridge/CallBridgeProvider.swift` (Stage 2 新規) | 同上。CXProvider 生成・CXProviderDelegate・終話・AVAudioSession 協調を実装 | ✅ 同上 |

---

## 4. Android Config Plugin (`plugins/with-android-native.js`)

| 対象 | 実装方式 | 状態 |
|---|---|---|
| `android/app/.../FcmService.kt` | `withDangerousMod("android")` で `plugins/templates/android/` からコピー。#H-3 対応で `TelecomManager.addNewIncomingCall` を実装し `CallBridgeModule.emitIncomingCall`/`emitDeviceToken` を呼ぶよう更新 | ✅ ファイル配置 + 実装済 |
| `android/app/.../HmacValidator.kt` | 同上 (変更なし) | ✅ 配置済 |
| `.FcmService` manifest 宣言 | `withAndroidManifest` (Stage 1 のまま) | ✅ 実装済 |
| `.CallConnectionService` / `.CallForegroundService` | ~~app manifest への個別宣言~~ → **Stage 2 で `modules/call-bridge/android/src/main/AndroidManifest.xml` (library 自身のマニフェスト) に移設**。Android の Gradle manifest merger が library の `<service>` 宣言を自動的に app module へマージする方式 (`expo-audio` 公式実装で実際に採用されているパターンであることを `node_modules` 内のソースで確認済み)。 | ✅ 実装済 (manifest merge の実挙動は Gradle ビルド未実施のため未検証) |
| `android.googleServicesFile` の条件付き設定 (Codex PR #75 P1-1 hotfix) | `withConditionalGoogleServicesFile`: config オブジェクトを直接変更 (mod ではない、他プラグインより前に実行)。`apps/mobile/google-services.json` が `fs.existsSync` で見つかった場合のみ `config.android.googleServicesFile` を設定 | ✅ 実装済・`npx expo config --json` で未配置時に未設定・配置時に自動設定の両方を実測確認済み |
| `BuildConfig.TRANCALL_PUSH_HMAC_SECRET` の `buildConfigField` 注入 (Codex PR #75 P1-2 hotfix) | `withHmacSecretBuildConfigField`: `withAppBuildGradle` で `app/build.gradle` の `defaultConfig` に `buildConfigField "String", "TRANCALL_PUSH_HMAC_SECRET", "\"${System.getenv('TRANCALL_PUSH_HMAC_SECRET') ?: ''}\""` を注入 (Gradle 評価時に環境変数を読む、未設定時は空文字)。AGP 8+ 向けに `buildFeatures { buildConfig true }` も未設定時のみ合わせて注入 | ✅ 文字列注入ロジックは実装・単体確認済み (`android {`/`defaultConfig {` への regex 挿入結果を node script で実測)。**Gradle ビルドでの実挙動 (BuildConfig.java 生成結果) は未検証** (device-verification-required、G-5 参照) |

サービスクラス名は `docs/native-call-bridge.md` §5.1 の設計 canonical (`.CallConnectionService` / `.CallForegroundService`) に統一し、`docs/sprint3-known-issues.md` §2.13 (FcmService 名不一致) と §2.14 (ConnectionService 名の揺れ) を解消した。

---

## 5. CallBridge Expo Module (`apps/mobile/modules/call-bridge/`)

### 5.1 アーキテクチャ上の決定 (Stage 2 で判明した制約への対応)

設計書 §3.4 は「Native (Swift/Kotlin): OS API ラッパー」と「JS Bridge (Expo Module)」を別レイヤーとしているが、**iOS の CocoaPods は pod (library) → app target の import を許可しない** (循環依存になるため)。このため:

- **iOS**: `modules/call-bridge/ios/CallBridgeModule.swift` (pod) は `CallBridgeProviding` プロトコルを定義し、app 側の `apps/mobile/ios/CallBridge/CallBridgeProvider.swift` がそれに準拠して `CallBridgeModule.providerDelegate` に自身を登録する (dependency inversion)。pod → app 方向の直接参照は排除した。
- **Android**: Gradle library module も app module に依存されるだけで app 側を参照できない制約は同じだが、**ConnectionService/Connection/ForegroundService を全て `modules/call-bridge/android/` (library) 内に配置**することで、この制約自体を回避した (TelecomManager は Android SDK のシステム API であり、app 側の型を必要としないため)。iOS のような protocol 越しの delegation は不要。

この非対称性 (iOS はプロトコル越し、Android は self-contained) は実装上の理由であり、意図的な設計判断としてここに明記する。

### 5.2 §7.1 CallBridge JS API 実装状況

| 関数 | TS (typecheck 可) | iOS Swift | Android Kotlin | 備考 |
|---|---|---|---|---|
| `registerForVoipPush()` | ✅ | ✅ スキャフォールド | ✅ スキャフォールド (Android は no-op、FCM token は `onNewToken` で自動取得のため) | |
| `startOutgoingCall()` | ✅ | ✅ `CXStartCallAction` | ✅ `TelecomManager.placeCall` | |
| `reportIncomingCall()` | ✅ | ✅ `CXProvider.reportNewIncomingCall` (JS 経由 debug path) | ✅ `TelecomManager.addNewIncomingCall` (同上) | Phase 1a note: 通常は native push handler が自動処理、JS 呼び出しは通常不要 |
| `answerCall()` | ✅ | ✅ `CXAnswerCallAction` (fallback) | ⚠️ **実質未対応** — Telecom に「UUID 指定で外部から応答」API が存在しない。JS 呼び出し時は `CALL_BRIDGE_CALL_NOT_FOUND` を reject する設計とした | Android は Telecom framework の制約 |
| `endCall()` | ✅ | ✅ `CXEndCallAction` | ⚠️ `TelecomManager.endCall()` (deprecated, API 28+, 「現在アクティブな通話」粒度の近似) | Android は Phase 1a (同時通話数1) 前提の近似実装 |
| `setMuted()` | ✅ | ✅ `CXSetMutedCallAction` | ✅ `AudioManager.isMicrophoneMute` (近似) | |
| `setSpeakerphone()` | ✅ | ✅ `AVAudioSession.overrideOutputAudioPort` | ✅ `AudioManager.isSpeakerphoneOn` | |
| `getCurrentCallState()` | ✅ | ✅ (`activeCalls` dictionary から) | ⚠️ **未実装** (`null` を返すのみ) — call state 追跡が `TranCallConnection` 側に閉じており、Module から横断参照する仕組みが無い | Sprint 4 で共有 state store 追加予定 |
| `on(eventType, handler)` | ✅ Zod safeParse 込み | ✅ `Events`/`sendEvent` | ✅ `Events`/`sendEvent` | |
| `validateCallPayload()` (#H-3、§7.1 外の追加関数) | ✅ | ✅ (app 側 `HmacValidator.swift` へ delegate) | ✅ (library 内に複製した `HmacValidator.kt`) | JS 側 defense-in-depth。権威ある検証は native push handler 側で実施済み |

### 5.3 CallEvent (Native → JS) 実装状況

| event | 発火元 (iOS) | 発火元 (Android) |
|---|---|---|
| `incomingCall` | `PushKitDelegate.swift` (reportNewIncomingCall 成功後) | `FcmService.kt` (addNewIncomingCall 呼び出し後) |
| `callAnswered` | `CallBridgeProvider` (`CXProviderDelegate.perform CXAnswerCallAction`) | `TranCallConnection.onAnswer()` |
| `callEnded` | `CallBridgeProvider` (`CXEndCallAction`) | `TranCallConnection.onDisconnect/onAbort/onReject` |
| `callMuted` | `CallBridgeProvider` (`CXSetMutedCallAction`) | `CallBridgeModule.setMuted` AsyncFunction 内で emit (Connection 個別追跡なし) |
| `audioRouteChanged` | `CallBridgeProvider.didActivate` (簡易実装、earpiece 固定) | `TranCallConnection.onCallAudioStateChanged` |
| `deviceTokenUpdated` | `PushKitDelegate.didUpdate pushCredentials` | `FcmService.onNewToken` |

---

## 6. FCM / EAS 前提設定

| 項目 | 状態 | 詳細 |
|---|---|---|
| `android.googleServicesFile` | ⚠️ 未配置 (Codex PR #75 P1-1 hotfix 済) | 従来 `app.json` に存在しない placeholder パス (`./google-services.json.PLACEHOLDER-REQUIRES-REAL-FIREBASE-CONFIG`) を直指定していたが、Expo 標準の `AndroidConfig.GoogleServices.withGoogleServicesFile` (`withDefaultPlugins` 経由で常に適用される) がファイルコピー時に例外を投げ `expo prebuild`/EAS Build がコンパイル前に失敗することが判明 (未設定より悪い状態)。**修正**: app.json から `googleServicesFile` 指定を削除し、`plugins/with-android-native.js` の `withConditionalGoogleServicesFile` が `apps/mobile/google-services.json` の実在を `fs.existsSync` で確認した場合のみ `config.android.googleServicesFile` を設定するよう変更 (`npx expo config --json` で未配置時に `android.googleServicesFile` キー自体が存在しないこと、配置時に自動で設定されることの両方を実測確認済み)。**実 Firebase プロジェクトの `google-services.json` を `apps/mobile/` 直下に配置すれば、app.json を編集しなくても次回 prebuild から自動的に有効化される。** 配置するまでは Android の FCM 初期化自体ができない (G-4 は解消していない、あくまで「プレースホルダーによるビルド破壊」を解消) |
| `extra.eas.projectId` | ⚠️ placeholder | `REPLACE_WITH_REAL_EAS_PROJECT_ID_UUID`。実 EAS project 作成後に UUID へ差し替えが必要。 |
| `TRANCALL_PUSH_HMAC_SECRET` (EAS Secret) | ⚠️ Secret 登録は未設定、Android 注入配線は実装済み (Codex PR #75 P1-2 hotfix 済) | `eas.json` の `development`/`preview`/`production` プロファイルに `env.TRANCALL_PUSH_HMAC_SECRET_SETUP_NOTE` として手順コメントを配置 (実値は書いていない)。実際の登録は `eas secret:create --scope project --name TRANCALL_PUSH_HMAC_SECRET --value <secret>` で行う (`docs/native-call-bridge.md` §12.1、EAS は登録済み secret をビルド時に自動で環境変数として注入するため `eas.json` 側の追加設定は不要)。**Android 側の `buildConfigField` 注入配線を実装済み**: `plugins/with-android-native.js` の `withHmacSecretBuildConfigField` が `withAppBuildGradle` (`expo/config-plugins`) 経由で `app/build.gradle` の `defaultConfig` に `buildConfigField "String", "TRANCALL_PUSH_HMAC_SECRET", "\"${System.getenv('TRANCALL_PUSH_HMAC_SECRET') ?: ''}\""` を注入する (Gradle 評価時に環境変数を読み、未設定時は空文字にフォールバックしてビルド自体は落とさない)。AGP 8+ で `BuildConfig` 生成が既定無効な場合に備え `buildFeatures { buildConfig true }` も未設定時のみ合わせて注入する。**Gradle ビルドでの実注入結果は未検証** (device-verification-required、下記 G-5 参照)。iOS 側は `expo-secure-store` への書き込みタイミング・Keychain 読み出しロジックが `CallBridgeProvider.fetchHmacSecretPlaceholder()` に TODO として残っている。 |

---

## 7. 明示的な device-verification-required ギャップ一覧

実機/エミュレータでの検証が必須であり、かつ**現状コード上でも既知の未解決ポイント**を列挙する (「型は通るが実機で動くか分からない」の中でも、特に注意が必要な項目):

| # | ギャップ | 影響 | 対応方針 |
|---|---|---|---|
| G-1 | iOS: `CallBridgeProvider.shared.register()` を呼ぶ箇所が無い | JS から `callBridge.startOutgoingCall()` 等を呼んでも `CALL_BRIDGE_native_not_registered` 相当のエラーになる (`providerDelegate` が nil のまま) | `expo prebuild` が生成する `ios/TranCall/AppDelegate.swift` の `didFinishLaunchingWithOptions` に `CallBridgeProvider.shared.register()` を追加する配線が実機ビルド時に必要 |
| G-2 | iOS: `ios/CallBridge/*.swift` の Xcode プロジェクト (.pbxproj) への Compile Sources 登録が未自動化 | Config Plugin はファイルをコピーするのみ。Xcode が実際にコンパイル対象として認識するには pbxproj への追加が必要 | `@expo/config-plugins` の `IOSConfig.XcodeProjectFile.withBuildSourceFile` 系 API での自動化、または実機ビルド時に手動で "Add Files to..." | 
| G-3 | iOS: HMAC secret 取得が placeholder (空文字) | `PushKitDelegate` の HMAC 検証が常に失敗する (空 secret で計算した signature は実際の signature と一致しない) → 着信が常に drop される | `expo-secure-store` からの実読み出しロジックを実装 (Keychain 経由) |
| G-4 | Android: `google-services.json` 未配置 | FCM 自体が初期化できず `FcmService` が起動しない (Codex P1-1 hotfix によりビルド自体は壊れなくなったが、この機能ギャップ自体は未解消) | 実 Firebase プロジェクトの `google-services.json` を `apps/mobile/` 直下に配置する。配置すると `withConditionalGoogleServicesFile` が自動検知し次回 prebuild から有効化される (app.json 編集不要) |
| G-5 | Android: `BuildConfig.TRANCALL_PUSH_HMAC_SECRET` の EAS Secret 未登録 | Codex P1-2 hotfix で `plugins/with-android-native.js` の `withHmacSecretBuildConfigField` (`withAppBuildGradle` 経由) が `buildConfigField` 注入配線自体は実装済みになったが、`TRANCALL_PUSH_HMAC_SECRET` の EAS Secret 本体を登録するまでは `System.getenv(...)` が空文字を返し `FcmService.getHmacSecret()` が常に null → 着信が常に drop される | `eas secret:create --scope project --name TRANCALL_PUSH_HMAC_SECRET --value <secret>` で本番前に登録 (`docs/native-call-bridge.md` §12.1)。**未検証**: 実際に Gradle ビルドを実行し `BuildConfig.TRANCALL_PUSH_HMAC_SECRET` が期待通り生成・注入されることの確認 (Android Studio / Gradle 未検証環境のため) |
| G-6 | Android: `CallForegroundService` の通知アイコンが Android 標準アイコンの暫定流用 | 見た目がブランドと不一致 (機能上は問題なし) | 実アイコンリソースを library module に同梱するか、通知構築を app 側に移す設計変更 |
| G-7 | Android: `getCurrentCallState()` が常に `null` | JS 側の state 再同期 (§7.4、5秒間隔ポーリング/前景復帰時) が機能しない | 共有 state store (Kotlin object) を追加し `TranCallConnection` と `CallBridgeModule` の両方から参照させる |
| G-8 | Android: `answerCall()`/`endCall()` が Telecom API の制約で不完全 | JS からの明示的な応答/終話操作 (fallback 経路) が期待通り動かない可能性 | 実機で `TelecomManager` の挙動を確認し、必要なら `Connection` インスタンスを `CallBridgeModule` 内で追跡する設計に変更 |
| G-9 | `src/lib/livekit/audio-session.ts` (設計書 §4.7 が参照するファイル) が未作成 | CallKit `didActivate` と LiveKit `AudioSession.startAudioSession()` の協調タイミングが JS 側に実装されていない | `@livekit/react-native` 依存追加の判断 (下記§8) と合わせて実装が必要 |
| G-10 | `packages/shared-kernel` へのスキーマ配置 (§7.5 canonical) を本タスクのスコープ制約により見送り | `CallStateSchema`/`CallEventSchema`/`IncomingCallPushPayloadSchema` が `apps/mobile/modules/call-bridge/src/CallBridge.types.ts` に留まり、`packages/notification` 側の Zod schema (Sprint 3 で `packages/notification/src/schemas.ts` に追加された `uuid`/`callerId`/`issuedAt`/`expiresAt`/`signature`) と型レベルでは独立している (wire format は互換だが単一ソースではない) | スコープ制約解除後に `packages/shared-kernel/src/schemas/native-call.ts` へ移設 |

---

## 8. 依存追加の是非判断: `@livekit/react-native`

- **現状**: `apps/mobile/package.json` に `@livekit/react-native` は追加していない。`apps/mobile/src/lib/livekit/connect.ts` は `require("@livekit/react-native")` を動的に呼び、存在しない場合は明示的エラーを throw する設計 (Wave1 で既に実装済み、Stage 1/2 では変更していない)。
- **今回の判断**: **追加しない**。理由:
  1. 依存追加には native linking (pod install / gradle sync) が伴い、この環境では追加してもビルド検証が一切できず、「追加したが動作未確認」という状態を作るだけで実質的な進捗にならない。
  2. 設計書 §3.3 の "自前 Expo Module" 方針と、LiveKit の音声トラック接続は別レイヤーの関心事であり (§3.4 layering: Native は OS API ラッパー、LiveKit 接続は JS の CallStore/connect.ts が担当)、CallBridge Module 自体の実装完成に `@livekit/react-native` は不要。
  3. `connect.ts`/`in-call-screen.tsx` は既に「無ければ reject して安全に fallback」する設計になっており (今回のセッションで `MicrophonePermissionDeniedError` 等と合わせて確認・強化済み)、依存が無い状態でも TS 側は健全に動作する。
- **推奨フォローアップ**: 実際に Xcode/Android Studio でビルドできる環境が用意された段階で、`npx expo install @livekit/react-native @livekit/react-native-webrtc` を実行し、`connect.ts` の `loadLiveKitModule()` と `src/lib/livekit/audio-session.ts` (未作成、G-9) を実装・実機で音声疎通を検証する。

---

## 9. #54 (SDK54 版整合) が全体に与えた影響

- `react-native`: 0.76.9 → 0.81.5、`react`: 19.0.0 → 19.1.0、`@types/react`: 19.0.14 → 19.1.17
- `@expo/vector-icons` 14→15、`expo-file-system` 18→19 (API 移動: `expo-file-system/legacy` へ)、`expo-localization` 15→17、`expo-secure-store` 14→15、`expo-sharing` 13→14、`expo-status-bar` 1→3、`react-native-safe-area-context`/`react-native-screens` も SDK54 pin へ
- 新規追加: `expo-audio` (#32 マイク権限)、`expo-notifications` (#32 通知権限)、`expo-modules-core` (CallBridge Module)
- **影響範囲**: `apps/mobile` と `packages/ui-kit` のみ。`pnpm turbo typecheck` で全16パッケージ (`shared-kernel`/`auth`/`room`/`media`/`billing`/`notification`/`transcript`/`translation`/`contact`/`app-server`/`app-translation-agent`/`cron`/`mock-server`/`integration-tests` 含む) が green であることを確認済み。他パッケージのコードは一切変更していない。
- **壊れた箇所と修正**: `expo-file-system` v19 の legacy API 移動により `full-transcript-screen.tsx` と `__tests__/transcript-export.test.ts` の import path (`expo-file-system` → `expo-file-system/legacy`) を修正 (機能変更なし、import path のみ)。

---

## 10. テスト・検証コマンド (再現用)

```bash
export PATH="/opt/homebrew/opt/node@23/bin:$PATH"
pnpm --filter @trancall/app-mobile typecheck   # green (modules/call-bridge 含む)
pnpm --filter @trancall/app-mobile test        # green (542 tests / 36 files)
pnpm turbo typecheck                            # green (26/26 tasks, 全16パッケージ)
cd apps/mobile
npx expo config --json > /dev/null && echo CONFIG_OK
npx expo-modules-autolinking search --platform ios --json      # call-bridge 発見確認
npx expo-modules-autolinking resolve --platform ios --json     # podspec 解決確認
npx expo-modules-autolinking search --platform android --json  # call-bridge 発見確認
npx expo-modules-autolinking resolve --platform android --json # gradle module 解決確認
```
