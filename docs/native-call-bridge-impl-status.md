# Native Call Bridge 実装状況 (#68 Stage 1/2)

| 項目 | 内容 |
|------|------|
| 上位設計 | `docs/native-call-bridge.md` (canonical) |
| 対応 Issue | #54 #56 #30 #68 #32 #33 (Stage 1) / #68 #32 (Stage 2) |
| 作業ブランチ | `w3/mobile-native` |
| 対象範囲 | `apps/mobile/`, `packages/ui-kit/` (Stage 1/2)。**H-1〜L-9 (このセッション) で `packages/shared-kernel/`, `packages/notification/` にも canonical schema 移設 (L-9) のため変更が及んだ** (`server/` は依然未変更) |
| 最重要の前提 | **この環境では Xcode / Android Studio によるネイティブビルド・実機/シミュレータ検証が一切できない。** 以下の Swift/Kotlin 実装は全て「型・構造としては妥当だが未コンパイル・未実行」のスキャフォールドである。各ファイル冒頭に `⚠️ device-verification-required` コメントを付与済み。 |

---

## 1. 検証方法の正直な区分

| 検証方法 | 対象 | 実施状況 |
|---|---|---|
| `tsc --noEmit` (typecheck) | TS/TSX 全ファイル (`modules/call-bridge` 含む) | ✅ 実施・green |
| `vitest run` (単体テスト) | TS ロジック (permissions, incoming-call-push, hmac-validator, audio-session 等) | ✅ 実施・green (581 tests / 41 files、H-1〜L-9 このセッションで +5 tests / +1 file) |
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
| `ios/CallBridge/HmacValidator.swift` | `withDangerousMod("ios")` で `plugins/templates/ios/CallBridge/` からコピー | ✅ ファイル配置 + **H-2 (このセッション): pbxproj Compile Sources 登録も自動化済み** (`withIosCallBridgePbxprojSources`、下記§7 G-2 参照) |
| `ios/CallBridge/PushKitDelegate.swift` | 同上。#H-3 対応で `CallBridgeModule.emitDeviceToken`/`emitIncomingCall` を呼ぶよう更新 | ✅ 同上 (pbxproj 登録込み) |
| `ios/CallBridge/CallBridgeProvider.swift` (Stage 2 新規) | 同上。CXProvider 生成・CXProviderDelegate・終話・AVAudioSession 協調を実装 | ✅ 同上 (pbxproj 登録込み) |

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
| `answerCall()` | ✅ | ✅ `CXAnswerCallAction` (fallback) | ✅ **M-7 (このセッション) 解消**: `CallConnectionStore` (共有 state store) が保持する `TranCallConnection` を uuid 一致で引き当て、`answerFromJs()` (= 公式 API `Connection.onAnswer()` を直接呼ぶ、システム UI 経由の応答と同じコードパス) で応答する。追跡中の Connection が無い/uuid 不一致の場合のみ `CALL_BRIDGE_CALL_NOT_FOUND` を reject | Android は Telecom framework の制約下でも Self-Managed Connection が同一プロセス内オブジェクトであることを利用 |
| `endCall()` | ✅ | ✅ `CXEndCallAction` | ✅ **M-7 (このセッション) 改善**: 追跡中の Connection が uuid 一致すれば `endFromJs()` (= `Connection.onDisconnect()` を直接呼ぶ) で当該 Connection のみを正確に終話。見つからない場合のみ `TelecomManager.endCall()` (deprecated, API 28+, 「現在アクティブな通話」粒度の近似) へ fallback | Phase 1a (同時通話数1) 前提 |
| `setMuted()` | ✅ | ✅ `CXSetMutedCallAction` | ✅ `AudioManager.isMicrophoneMute` (近似) | |
| `setSpeakerphone()` | ✅ | ✅ `AVAudioSession.overrideOutputAudioPort` | ✅ `AudioManager.isSpeakerphoneOn` | |
| `getCurrentCallState()` | ✅ | ✅ (`activeCalls` dictionary から) | ✅ **M-7 (このセッション) 解消**: `CallConnectionStore` (`modules/call-bridge/android/.../CallConnectionStore.kt`、新設) が `TranCallConnection` を `WeakReference` で保持し、`CallBridgeModule` から横断参照できるようにした (`{uuid, state} | null` を返す) | `TranCallConnection.init{}` で自己登録、`onDisconnect/onAbort/onReject` で解除 |
| `on(eventType, handler)` | ✅ Zod safeParse 込み | ✅ `Events`/`sendEvent` | ✅ `Events`/`sendEvent` | |
| `validateCallPayload()` (#H-3、§7.1 外の追加関数) | ✅ | ✅ (app 側 `HmacValidator.swift` へ delegate) | ✅ (library 内に複製した `HmacValidator.kt`) | JS 側 defense-in-depth。権威ある検証は native push handler 側で実施済み。**✅ #68/#70 このセッションで配線完了**: `src/lib/callkit/voip-push.ts` の legacy (react-native-voip-push-notification 経由) 着信パスから `verifyIncomingCallHmac()` (新規、`expo-secure-store` から secret 取得 → `validateCallPayload()` 呼び出し) を CallKit `displayIncomingCall` 直前に呼ぶよう配線。secret 未取得時・検証失敗時は fail-closed (CallKit に何も投入しない、`notification-detail.md` §3 canonical 準拠)。ただし `expo-secure-store` への secret 書き込み (アプリ起動時に EAS Secret 由来の値を保存する処理) 自体は未実装のままのため、実機では secret 常時 null → 常に fail-closed になる (下記 G-3 と対になる JS 側の残課題、新規 G-11 参照) |

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
| G-1 | ✅ **解消 (#68/#70 このセッション)**。~~iOS: `CallBridgeProvider.shared.register()` を呼ぶ箇所が無い~~ | ~~JS から `callBridge.startOutgoingCall()` 等を呼んでも `CALL_BRIDGE_native_not_registered` 相当のエラーになる (`providerDelegate` が nil のまま)~~ | `plugins/with-ios-callbridge.js` の `withIosAppDelegateCallBridgeInit` (`withAppDelegate` + regex 冪等注入) が `expo prebuild` 生成後の `ios/TranCall/AppDelegate.swift` の `didFinishLaunchingWithOptions` 冒頭に `CallBridgeProvider.shared.register()` + `requestVoipPushRegistration()` を自動注入することを実測確認済み (`npx expo prebuild --clean` で生成された実ファイルで検証)。合わせて `CallBridgeProvider.requestVoipPushRegistration()` 内で `PKPushRegistry(queue: nil)` を生成・保持 (`private var pushRegistry: PKPushRegistry?`) し `delegate`/`desiredPushTypes` を設定するよう修正 (以前は `PKPushRegistry(` の生成コード自体がリポジトリ全体にゼロ件だった)。**引き続き Xcode コンパイル自体は device-verification-required** (この環境では検証不能)。 |
| G-2 | ✅ **解消 (H-2、このセッション)**。~~iOS: `ios/CallBridge/*.swift` の Xcode プロジェクト (.pbxproj) への Compile Sources 登録が未自動化~~ | ~~Config Plugin はファイルをコピーするのみ。Xcode が実際にコンパイル対象として認識するには pbxproj への追加が必要~~ | `plugins/with-ios-callbridge.js` の `withIosCallBridgePbxprojSources` (`withXcodeProject` mod、`IOSConfig.XcodeUtils.ensureGroupRecursively` + `addBuildSourceFileToGroup`) が PBXFileReference / PBXBuildFile / PBXSourcesBuildPhase への登録を自動化することを実測確認済み (`npx expo prebuild --clean` 後の `ios/TranCall.xcodeproj/project.pbxproj` に `HmacValidator.swift` / `PushKitDelegate.swift` / `CallBridgeProvider.swift` の 3 ファイルとも Sources build phase entry が生成されていることを grep で確認)。**引き続き Xcode/xcodebuild による実コンパイル可否自体は device-verification-required** (この環境では検証不能)。 |
| G-3 | iOS: HMAC secret 取得が placeholder (空文字) | `PushKitDelegate` の HMAC 検証が常に失敗する (空 secret で計算した signature は実際の signature と一致しない) → 着信が常に drop される | `expo-secure-store` からの実読み出しロジックを実装 (Keychain 経由) |
| G-4 | Android: `google-services.json` 未配置 | FCM 自体が初期化できず `FcmService` が起動しない (Codex P1-1 hotfix によりビルド自体は壊れなくなったが、この機能ギャップ自体は未解消) | 実 Firebase プロジェクトの `google-services.json` を `apps/mobile/` 直下に配置する。配置すると `withConditionalGoogleServicesFile` が自動検知し次回 prebuild から有効化される (app.json 編集不要) |
| G-5 | Android: `BuildConfig.TRANCALL_PUSH_HMAC_SECRET` の EAS Secret 未登録 | Codex P1-2 hotfix で `plugins/with-android-native.js` の `withHmacSecretBuildConfigField` (`withAppBuildGradle` 経由) が `buildConfigField` 注入配線自体は実装済みになったが、`TRANCALL_PUSH_HMAC_SECRET` の EAS Secret 本体を登録するまでは `System.getenv(...)` が空文字を返し `FcmService.getHmacSecret()` が常に null → 着信が常に drop される | `eas secret:create --scope project --name TRANCALL_PUSH_HMAC_SECRET --value <secret>` で本番前に登録 (`docs/native-call-bridge.md` §12.1)。**未検証**: 実際に Gradle ビルドを実行し `BuildConfig.TRANCALL_PUSH_HMAC_SECRET` が期待通り生成・注入されることの確認 (Android Studio / Gradle 未検証環境のため) |
| G-6 | ✅ **解消 (L-7、このセッション)**。~~Android: `CallForegroundService` の通知アイコンが Android 標準アイコンの暫定流用~~ | ~~見た目がブランドと不一致 (機能上は問題なし)~~ | `CallForegroundService.resolveSmallIconResId()` が `Resources.getIdentifier` でアプリ側リソース (`drawable/ic_notification` → `mipmap/ic_launcher_foreground` → `mipmap/ic_launcher` の優先順位) を実行時解決するよう実装。いずれも未解決の場合のみ Android 標準アイコンへ最終フォールバック (crash 防止)。**⚠️ 実際にどのリソース名が解決されるか (アプリ側が `ic_notification` 相当の単色シルエット drawable を用意していない場合、`ic_launcher_foreground`/`ic_launcher` にフォールバックする見た目) は実機ビルド未検証** |
| G-7 | ✅ **解消 (M-7、このセッション)**。~~Android: `getCurrentCallState()` が常に `null`~~ | ~~JS 側の state 再同期 (§7.4、5秒間隔ポーリング/前景復帰時) が機能しない~~ | `CallConnectionStore` (Kotlin object、新設) を追加し `TranCallConnection.init{}` で自己登録・`onDisconnect/onAbort/onReject` で解除。`CallBridgeModule.getCurrentCallState()` はここから `{uuid, state}` を返す。**⚠️ Gradle ビルド未検証のため実際のコンパイル可否・実機での state 追跡精度は device-verification-required** |
| G-8 | ✅ **解消 (M-7、このセッション)**。~~Android: `answerCall()`/`endCall()` が Telecom API の制約で不完全~~ | ~~JS からの明示的な応答/終話操作 (fallback 経路) が期待通り動かない可能性~~ | `TranCallConnection.answerFromJs()`/`endFromJs()` が公式 API (`Connection.onAnswer()`/`onDisconnect()`、いずれも public) を直接呼び、システム UI 経由と同じコードパスで uuid 指定の応答/終話を実現。`CallBridgeModule` は `CallConnectionStore` 経由で uuid が一致する Connection を引き当ててから呼ぶ。**⚠️ 実機での Telecom framework 実挙動 (self-managed Connection への直接メソッド呼び出しが実際に system UI と整合するか) は device-verification-required** |
| G-9 | ✅ **解消 (H-3 d、このセッション)**。~~`src/lib/livekit/audio-session.ts` (設計書 §4.7 が参照するファイル) が未作成~~ | ~~CallKit `didActivate` と LiveKit `AudioSession.startAudioSession()` の協調タイミングが JS 側に実装されていない~~ | `src/lib/livekit/audio-session.ts` を新規作成。`createCallKitAudioSessionCoordinator()` (native module 非依存の純粋ロジック、ユニットテスト済み) + `startCallKitAudioSessionCoordination()` (CallBridge の `audioRouteChanged`/`callEnded` event 購読、iOS のみ) を実装。`index.ts` で `registerGlobals({ autoConfigureAudioSession: false })` を呼び LiveKit SDK 側の自動 audio session 管理 (CallKit と競合しうる) を無効化した上で、本モジュールが手動協調する設計。**⚠️ 呼び出し箇所自体 (in-call-screen 等への配線) は別 workstream の担当範囲のため本セッションでは未実施 — export 済みの関数を呼ぶだけで配線可能な状態。実機での CallKit⇄LiveKit 協調タイミングの実挙動は device-verification-required** |
| G-10 | ✅ **解消 (L-9、このセッション)**。~~`packages/shared-kernel` へのスキーマ配置 (§7.5 canonical) を本タスクのスコープ制約により見送り~~ | ~~`CallStateSchema`/`CallEventSchema`/`IncomingCallPushPayloadSchema` が `apps/mobile/modules/call-bridge/src/CallBridge.types.ts` に留まり、`packages/notification` 側の Zod schema と型レベルでは独立~~ | `packages/shared-kernel/src/schemas/native-call.ts` へ移設し canonical 化。`apps/mobile/modules/call-bridge/src/CallBridge.types.ts` は re-export のみ (wire 互換を保ったまま単一ソース化、call-bridge module 内の import 元は変更不要)。`packages/notification/src/schemas.ts` は新設の `CallRoomTypeSchema` (roomType の値ドメイン、3箇所で使用) を shared-kernel から import して統一。**意図的に統一しなかった箇所**: `uuid`/`roomId`/`callerAvatarUrl` 等の検証の厳しさ (branded `RoomId`・`z.url()`・`z.uuid()` 等) — notification 側はサーバー送信前の厳格バリデーション、call-bridge 側はクライアント受信後の defense-in-depth な寛容 parse という役割の違いが意図的なため、Zod schema 自体は分離を維持 (コメントで明記)。 |
| G-11 (新規、#68/#70) | JS 側 (mobile) で `TRANCALL_PUSH_HMAC_SECRET` を `expo-secure-store` に書き込む起動時ロジックが未実装 | `voip-push.ts` の `verifyIncomingCallHmac()` は配線済みだが `SecureStore.getItemAsync("trancall:push-hmac-secret")` が常に `null` を返すため、legacy (react-native-voip-push-notification 経由) 着信パスは常に fail-closed で着信を破棄する (native-side の G-3 と対になる JS 側の同種ギャップ)。ただし legacy パス自体が `react-native-voip-push-notification` 未導入のため現状 no-op であり実害は無い (#68 の CallBridge Module 経由の着信は native 側で HMAC 検証済み、こちらとは独立) | EAS Secret 経由でビルド時注入された値をアプリ起動時に `SecureStore.setItemAsync("trancall:push-hmac-secret", ...)` へ書き込む初期化コードを実装 (G-3 の Keychain 読み出し実装と対で Sprint 4 以降に対応) |

---

## 8. 依存追加の是非判断: `@livekit/react-native`

**Status: 2026-07 (#68/#70) 追加済みに判断変更。以下は判断変更前の旧記録。**

- **旧状態 (#68/#70 着手前)**: `apps/mobile/package.json` に `@livekit/react-native` は追加していなかった。`apps/mobile/src/lib/livekit/connect.ts` は `require("@livekit/react-native")` を動的に呼び、存在しない場合は明示的エラーを throw する設計 (Wave1 で既に実装済み)。
- **旧判断 (Stage 1/2 時点)**: 追加しない。理由は「この環境では native linking のビルド検証が一切できず『追加したが動作未確認』という状態を作るだけ」「connect.ts が無ければ reject する安全な fallback 設計になっている」等。
- **#68/#70 での判断変更: 追加した。** 理由:
  1. Issue #68/#70 で明示的に「`@livekit/react-native` を実際の依存として追加し `pnpm install` を実行すること」が要求された。
  2. 公式インストール手順 (`livekit/client-sdk-react-native` README) は `@livekit/react-native` 単独ではなく `@livekit/react-native @livekit/react-native-webrtc livekit-client` の 3 点セットを要求している (`@livekit/react-native` の `peerDependencies` に `livekit-client: ^2.19.0` / `@livekit/react-native-webrtc: ^144.1.1` が必須指定されているため、片方だけ入れても実行時 import が解決しない)。3 点とも追加した:
     - `@livekit/react-native@2.11.1` (peer: react/react-native は `*`、RN 0.81.5 と互換)
     - `@livekit/react-native-webrtc@144.1.1` (peer: `react-native >=0.60.0`)
     - `livekit-client@2.20.1` (`@livekit/react-native` の peer 要求 `^2.19.0` を満たす最新)
  3. `pnpm install` は追加の peer dependency 警告なくクリーンに解決 (既存の `react-dom`/`react-test-renderer` peer 警告は本変更と無関係の pre-existing なもの)。
  4. `npx expo-modules-autolinking search --platform ios/android` では `@livekit/react-native` 自体は検出されない (Expo Modules API ではなく classic React Native autolinking — `ios/Podfile` の `use_native_modules!` / Android `settings.gradle` の `native_modules.gradle` 経由で解決される想定。`ios/Podfile` に `use_native_modules!(config_command)` が Expo 標準テンプレートに含まれることを実測確認済み)。
- **H-3 (このセッション) で完了**:
  - `AppDelegate.swift`/`MainApplication.kt` への `LivekitReactNative.setup()` 配線は、**自前の regex 注入コードではなく `@livekit/react-native-expo-plugin` (公式 Expo Config Plugin, v1.0.2) を導入する方式を採用**した。
    理由: 同パッケージの `expo-module.config.json` が `ios.appDelegateSubscribers: ["LiveKitExpoAppDelegate"]` を宣言しており、Expo Modules の標準自動リンク機構 (iOS は `ExpoAppDelegateSubscriber`、Android は `android/.../LiveKitExpoPackage.kt` の `ApplicationLifecycleListener`) が `pod install`/Gradle sync 時に自動的に `LivekitReactNative.setup()`/`LiveKitReactNative.setup(application, audioType)` を呼ぶよう配線してくれる (パッケージ本体の `ios/LiveKitExpoAppDelegate.swift` / `android/.../LiveKitApplicationLifecycleListener.kt` で実装を確認済み)。
    これは §3 (`PrivacyInfo.xcprivacy`) で採用した「Expo 公式のより堅牢な仕組みが既存する場合はそちらを優先する」という本ドキュメントの既存方針と同じ判断基準であり、`ios/CallBridge/CallBridgeProvider.swift`/`AppDelegate.swift` のような自前 regex 注入 (壊れやすく保守コストが高い) を避けられる。
    `app.json` の `plugins` に `"@livekit/react-native-expo-plugin"` を追加し、`npx expo-modules-autolinking search --platform ios/android --json` で当該パッケージが `appDelegateSubscribers: ["LiveKitExpoAppDelegate"]` 付きで discover されることを実測確認済み (iOS/Android 両方)。
    **⚠️ 実際に `pod install`/Gradle sync を実行して `ExpoModulesProvider.swift` に `LiveKitExpoAppDelegate` が登録され、かつ `LivekitReactNative.setup()` が実際に呼ばれることの実機/シミュレータ検証は device-verification-required** (Xcode/Android Studio 無し環境のため未実施)。
  - JS 側の `registerGlobals()` 呼び出しは `apps/mobile/src/lib/livekit/register-globals.ts` (新規) に実装し、`index.ts` (アプリエントリポイント) から起動時に一度呼ぶ。`autoConfigureAudioSession: false` を明示し、audio session の自動アクティベートを無効化 (理由は下記 `audio-session.ts` 参照)。native module 未リンク時 (Expo Go 等) は try-catch で無害にフォールバックする設計 (`connect.ts` の `loadLiveKitModule()` と同じ防御パターン)。
  - `src/lib/livekit/audio-session.ts` (G-9) を新規作成。CallKit `didActivate` (native 側で `audioRouteChanged` event として emit される) を購読し、`AudioSession.configureAudio()` + `startAudioSession()` を呼ぶ協調ロジックを実装 (§4.7 準拠)。純粋ロジック (`createCallKitAudioSessionCoordinator`) は native module 非依存でユニットテスト済み (5 tests、`__tests__/livekit-audio-session.test.ts`)。
    **設計上の注記**: 設計書 §4.7 のコード例は `AudioSession.configureAudio()` の引数に `audioCategoryOptions`/`audioMode` を含めているが、実際にインストールした `@livekit/react-native@2.11.1` の `AudioConfiguration` 型は `ios.defaultOutput` のみを受け付ける (`audioCategoryOptions`/`audioMode` は別メソッド `setAppleAudioConfiguration()` 向け)。category/mode 自体は native 側 `CallBridgeProvider.swift` の `didActivate` ハンドラで既に `.playAndRecord`/`.voiceChat`/`allowBluetooth` 等を設定済みのため、JS 側で重複して `setAppleAudioConfiguration()` を呼ぶ必要はないと判断し、`configureAudio({ios: {defaultOutput: "speaker"}})` + `startAudioSession()` のみを実装した (設計書の例はやや旧 SDK バージョン向けの記述と判断)。
  - `connect.ts` の `loadLiveKitModule()` 自体は変更していない (require 経由の動的ロードのまま、型安全性重視の既存設計を維持)。
- **実機/シミュレータでの pod install・Gradle sync・実際の音声疎通検証・CallKit⇄LiveKit audio session 協調タイミングは device-verification-required のまま** (この環境に Xcode/Android Studio が無いため)。

---

## 9. #54 (SDK54 版整合) が全体に与えた影響

- `react-native`: 0.76.9 → 0.81.5、`react`: 19.0.0 → 19.1.0、`@types/react`: 19.0.14 → 19.1.17
- `@expo/vector-icons` 14→15、`expo-file-system` 18→19 (API 移動: `expo-file-system/legacy` へ)、`expo-localization` 15→17、`expo-secure-store` 14→15、`expo-sharing` 13→14、`expo-status-bar` 1→3、`react-native-safe-area-context`/`react-native-screens` も SDK54 pin へ
- 新規追加: `expo-audio` (#32 マイク権限)、`expo-notifications` (#32 通知権限)、`expo-modules-core` (CallBridge Module)
- **影響範囲**: `apps/mobile` と `packages/ui-kit` のみ。`pnpm turbo typecheck` で全16パッケージ (`shared-kernel`/`auth`/`room`/`media`/`billing`/`notification`/`transcript`/`translation`/`contact`/`app-server`/`app-translation-agent`/`cron`/`mock-server`/`integration-tests` 含む) が green であることを確認済み。他パッケージのコードは一切変更していない。
- **壊れた箇所と修正**: `expo-file-system` v19 の legacy API 移動により `full-transcript-screen.tsx` と `__tests__/transcript-export.test.ts` の import path (`expo-file-system` → `expo-file-system/legacy`) を修正 (機能変更なし、import path のみ)。

---

## 11. #56 (CNG と bare ファイル管理の矛盾) 対応 — このセッション

`apps/mobile/android/` `apps/mobile/ios/` が bare files として git 追跡されたまま `.gitignore` に
エントリが無く、`eas build` の CNG (Continuous Native Generation) 自動判定と矛盾していた問題
(詳細は Issue #56 本文 / コメント参照) を解消した。

- **安全確認 (untrack 前提)**: `git rm --cached` する前に、以下を実測で確認した。
  - `git ls-files` で tracked だった 7 ファイル (`android/.../FcmService.kt` `HmacValidator.kt`、
    `ios/CallBridge/{CallBridgeProvider,HmacValidator,PushKitDelegate}.swift`、
    `ios/TranCall/{PrivacyInfo.xcprivacy,TranCall.entitlements}`) のうち、
    Kotlin/Swift の 5 ファイルは `plugins/templates/` 配下の対応テンプレートと **`diff` でバイト単位一致**
    (`expo prebuild --clean` を実際に実行し、新規生成された `android/`・`ios/` 配下のファイルと
    テンプレートを再度 diff しても一致することを確認、静的比較だけでなく実行時の再現性も検証済み)。
  - 残る 2 ファイル (`TranCall.entitlements` / `PrivacyInfo.xcprivacy`) は静的テンプレートではなく、
    Expo 標準 mod (`withEntitlementsPlist` / `withPrivacyInfo`、`app.json` の `ios.entitlements` /
    `ios.privacyManifests` が正本) が都度動的生成する設計であることを `native-call-bridge-impl-status.md`
    §3 (旧記述) 通り確認。`expo prebuild --clean` で実際に再生成させたところ、XML の整形・コメント有無が
    異なるのみで意味的な内容 (キー/値) は完全一致することを確認した (comments はプレーンな plist writer が
    ラウンドトリップで保持しないため消える。これは "ドリフト" ではなく仕様通りの挙動)。
  - 以上により、`plugins/templates/` (+ `app.json`) が唯一の正本であり、`git rm --cached` によって
    失われるユニークな情報が無いことを確認した上で untrack を実施した。
- **実施内容**:
  - `git rm -r --cached apps/mobile/android apps/mobile/ios` (作業ツリーの実ファイルは削除していない)
  - `apps/mobile/.gitignore` を新規作成し `android/` `ios/` を追加
  - `.github/workflows/e2e.yml` は `expo prebuild --platform ios/android` を明示的に実行してから
    `apps/mobile/ios`/`apps/mobile/android` を参照する構成のため、本変更による CI 影響は無いことを確認済み
    (`grep -n "expo prebuild" .github/workflows/e2e.yml` で該当行を実測確認)。
- **`.easignore` の要否**: 追加していない。EAS Build の git ベースのプロジェクトアーカイブは
  `.gitignore` を尊重するため、本対応で `android/`/`ios/` は自動的にアーカイブ対象外になる想定
  (EAS リモートビルドでの実挙動そのものはこの環境では検証不能、device-verification-required)。

---

## 12. #68/#70 追加配線 (このセッション)

- **`@livekit/react-native` 依存追加**: §8 (更新済み) 参照。`pnpm install` 実行済み、追加の
  peer dependency 警告なし。
- **JS 側 HMAC 検証配線**: `apps/mobile/src/native/HmacValidator.ts` の `validateCallPayload()` を
  `apps/mobile/src/lib/callkit/voip-push.ts` の legacy 着信パス (`createIncomingPushHandler`,
  旧 `registerIOSVoIPPush` 内の無名関数から純関数として切り出し) に配線。
  `expo-secure-store` から `trancall:push-hmac-secret` キーで secret を取得し検証、
  失敗時は CallKit に何も投入せず log only で破棄 (fail-closed)。secret 書き込み処理自体は
  未実装 (新規 G-11、§7 参照)。
- **iOS PKPushRegistry 実体化**: `apps/mobile/plugins/templates/ios/CallBridge/CallBridgeProvider.swift`
  (+ 追従して `apps/mobile/ios/CallBridge/CallBridgeProvider.swift`) に `PKPushRegistry` の生成・保持・
  delegate 登録を実装。`plugins/with-ios-callbridge.js` に `withIosAppDelegateCallBridgeInit`
  (`withAppDelegate` mod) を追加し、`expo prebuild` で生成される `AppDelegate.swift` の
  `didFinishLaunchingWithOptions` 冒頭へ `CallBridgeProvider.shared.register()` +
  `requestVoipPushRegistration()` を自動注入。`npx expo prebuild --clean` を実行し、
  実際に生成された `AppDelegate.swift` に注入されていること、再実行しても重複注入されない
  (冪等) ことを実測確認済み (G-1 解消)。

---

## 13. テスト・検証コマンド (再現用)

```bash
export PATH="/opt/homebrew/opt/node@23/bin:$PATH"
pnpm --filter @trancall/app-mobile typecheck   # green (modules/call-bridge 含む)
pnpm --filter @trancall/app-mobile test        # green (581 tests / 41 files、H-1〜L-9 このセッションで +5 tests / +1 file)
pnpm turbo typecheck lint test --filter=@trancall/app-mobile --filter=@trancall/shared-kernel --filter=@trancall/notification  # green (13/13 tasks、2回連続確認済み)
pnpm turbo typecheck                            # green (全17パッケージ、shared-kernel/notification 含む)
cd apps/mobile
npx expo config --json > /dev/null && echo CONFIG_OK
npx expo prebuild --clean --no-install          # green
# H-2 検証: pbxproj Compile Sources に CallBridge 3 ファイルが登録されたことを確認
grep -n "HmacValidator.swift\|PushKitDelegate.swift\|CallBridgeProvider.swift in Sources" ios/TranCall.xcodeproj/project.pbxproj
# H-3(a) 検証: AppDelegate.swift への CallBridgeProvider 初期化コード注入を確認 (#68/#70、変更なし)
grep -n "CallBridgeProvider.shared" ios/TranCall/AppDelegate.swift
npx expo-modules-autolinking search --platform ios --json      # call-bridge + @livekit/react-native-expo-plugin (appDelegateSubscribers) 発見確認
npx expo-modules-autolinking resolve --platform ios --json     # podspec 解決確認
npx expo-modules-autolinking search --platform android --json  # call-bridge + @livekit/react-native-expo-plugin 発見確認
npx expo-modules-autolinking resolve --platform android --json # gradle module 解決確認
```

---

## 14. H-1〜L-9 対応まとめ (このセッション)

未Issue化の監査結果 (H-1, H-2, H-3, M-6, M-7, L-7, L-9) への対応。担当範囲は
`apps/mobile/modules/call-bridge/**`, `apps/mobile/ios/**`, `apps/mobile/android/**`,
`apps/mobile/plugins/**`, `apps/mobile/app.json`, `packages/shared-kernel/**`,
`packages/notification/**`, `apps/mobile/src/lib/livekit/**`
(`apps/mobile/src/screens/**`, `apps/mobile/src/lib/callkit/**` は別 workstream)。

### 14.1 各項目の対応内容

| # | 内容 | 状態 |
|---|------|------|
| H-2 | iOS pbxproj Compile Sources 自動登録。`plugins/with-ios-callbridge.js` に `withIosCallBridgePbxprojSources` を追加 (§3, §7 G-2) | ✅ コード完成・prebuild 実測確認済み |
| H-3 | LiveKit RN 実接続の初期化配線 (a: `@livekit/react-native-expo-plugin` 導入、b: `registerGlobals()`、c: app.json plugins 追加、d: `audio-session.ts` 新規作成) (§8, §7 G-9) | ✅ コード完成・ユニットテスト済み・autolinking 実測確認済み |
| M-6 | 通話中 NotificationChannel の起動時作成 | ⚠️ 下記 14.2 参照 (完全な未実装ではなく、部分実装の頑健化) |
| M-7 | Android Telecom 制約下の answerCall/getCurrentCallState/endCall (§5.2, §7 G-7/G-8) | ✅ コード完成 (`CallConnectionStore` 新設) |
| L-7 | 通話中通知アイコンの実アイコン参照化 (§7 G-6) | ✅ コード完成 (`resolveSmallIconResId`、getIdentifier ベース) |
| L-9 | CallStateSchema/CallEventSchema/IncomingCallPushPayloadSchema の shared-kernel 移設 (§7 G-10) | ✅ 完了 (`packages/shared-kernel/src/schemas/native-call.ts`) |

### 14.2 M-6 の実態調査結果 (透明性のため明記)

着手前、オーケストレーターから「`CallBridgeModule.kt` の `OnCreate` で `ensureNotificationChannel` を
既に起動時に呼んでおり、`CallForegroundService.kt` 側のコメントが古いだけの可能性が高い」という
情報共有があった。実コードを確認した結果:

- **確認できた事実**: `CallBridgeModule.kt` の `OnCreate` ブロックは元々から channel ensure を
  呼んでいた (コメントは確かに古かった)。
- **それでも実装を追加した理由**: `OnCreate` は Expo Module のインスタンス化 (= React Native /
  Expo Modules ホストの起動) に依存する。着信は `FcmService.onMessageReceived`
  (通常の Android `FirebaseMessagingService`、RN ホストとは独立に Android がプロセスを起こせる
  headless 経路) → `TelecomManager.addNewIncomingCall` → `CallConnectionService` →
  `CallForegroundService.start()` という経路でも発生しうり、この経路では
  `CallBridgeModule` が一度もインスタンス化されないまま `startForeground()` に到達する
  可能性を排除できなかった (Expo/RN テンプレートは `Application.onCreate()` で RN ホストを
  eager 初期化しないため)。
  そのため「本当に完全に実装済みか」を保守的に判断し、**再実装ではなく最小限の頑健化**として:
  1. `CallForegroundService.onStartCommand()` の `startForeground()` 呼び出し直前に、同じ ensure 処理を
     直接呼ぶよう追加した (`CallNotificationChannels.ensureCallChannel()`、新設・共有化)。
     `NotificationManager.createNotificationChannel` は同一 channel の再作成が安全な no-op のため、
     `CallBridgeModule.OnCreate` 側との重複呼び出しは問題にならない。
  2. `CallForegroundService.kt:38-40` の「未実装」という誤解を招く古いコメントを実態に合わせて修正した。
- **結論**: 完全な「未実装」ではなく「部分実装 (モジュール初期化時のみ) + タイミング依存リスク」
  だった、というのが実態。コメント修正のみでなく、`startForeground` 呼び出し箇所自体にも
  ensure を追加したことで、どちらの起動経路でも channel 未作成のまま `startForeground` に
  到達しないことをコード上で保証した。

### 14.3 実機検証チェックリスト (device-verification-required、Xcode/Android Studio が使える環境で実施)

本セッションはコードを完成させたのみで、以下は全て未実施。実機/シミュレータが使える環境で
上から順に検証すること (依存関係の都合上、着信/発信より前に pod install / Gradle sync を通す)。

**共通 (ビルド前提)**
- [ ] iOS: `cd ios && pod install` が成功し、`ExpoModulesProvider.swift` に
      `CallBridge` (自前 module) と `LiveKitExpoAppDelegate` (`@livekit/react-native-expo-plugin`) の
      両方が登録されることを確認
- [ ] iOS: Xcode で `TranCall.xcodeproj` を開き、`ios/CallBridge/*.swift` 3 ファイルが
      Compile Sources に含まれ実際にビルド (⌘B) が通ることを確認 (H-2 の最終検証)
- [ ] Android: `./gradlew :app:assembleDebug` が成功し、`CallBridgeModule`/`CallConnectionStore`/
      `TranCallConnection`/`CallForegroundService`/`CallNotificationChannels` が期待通り
      コンパイルされることを確認 (M-6/M-7/L-7 の最終検証)
- [ ] Android: `BuildConfig.TRANCALL_PUSH_HMAC_SECRET` が実際に生成・注入されることを確認 (G-5)

**発信**
- [ ] iOS: 発信ボタン → CallKit 発信 UI が表示され、相手に着信が届く
- [ ] Android: 発信 → Telecom self-managed call UI が表示され、相手に着信が届く

**着信 (フォアグラウンド/バックグラウンド/killed 各状態で)**
- [ ] iOS: PushKit VoIP push → CallKit 着信 UI が (アプリが killed 状態でも) 表示される
- [ ] Android: FCM data message → Telecom 着信 UI が (アプリが killed 状態でも) 表示される
- [ ] Android: `CallForegroundService` の通話中通知が例外なく表示され、アイコンが
      期待通り (アプリ側リソースが解決されるか、フォールバックのシステムアイコンになるか) 表示される (M-6/L-7)

**応答 (answerCall)**
- [ ] iOS: CallKit UI の応答ボタン、および JS 経由の fallback (`callBridge.answerCall()`) の両方で応答できる
- [ ] Android: システム UI (heads-up 通知の応答ボタン) 経由の応答、および JS 経由の fallback
      (`callBridge.answerCall()`、M-7 で実装した `CallConnectionStore` 経由の応答) の両方で応答できる

**通話中操作**
- [ ] mute: 双方向で mute 状態が UI/相手に反映される
- [ ] speaker: 切り替えが実際の音声出力先に反映される
- [ ] iOS: `provider(_:didActivate:)` 発火後に `audio-session.ts` の
      `AudioSession.startAudioSession()` が呼ばれ、CallKit と音声が競合しない (H-3 d、G-9 の本丸)
- [ ] LiveKit room への実接続 (音声疎通) が成立する (`registerGlobals()` 配線含む)

**終話**
- [ ] iOS: CallKit UI からの終話、JS 経由の `callBridge.endCall()` の両方で終話できる
- [ ] Android: システム UI からの終話、JS 経由の `callBridge.endCall()`
      (M-7 で実装した uuid 指定の正確な終話) の両方で終話できる
- [ ] 終話後、`CallForegroundService`/通知が確実にクリアされる

**CallKit UI / ConnectionService 個別確認**
- [ ] iOS: 着信中に他アプリの通話 (電話/FaceTime) と競合した場合の挙動 (§9.3)
- [ ] Android: 他アプリの通話中に着信した場合の Self-Managed ConnectionService の挙動 (§9.3)
- [ ] iOS: ロック画面上での CallKit 着信 UI 表示・応答
- [ ] Android: ロック画面上での Telecom 着信 UI 表示・応答

上記チェックリストの実施結果 (PASS/FAIL とログ) は、実機/CI 環境が確保でき次第、
本ドキュメントおよび対応 GitHub Issue に追記すること。
