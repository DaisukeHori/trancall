# TranCall App Store 提出設計書

| 項目 | 内容 |
|------|------|
| ドキュメント ID | APP-STORE-SUBMIT-001 |
| Status | Draft v1.1 (2026-05-12) |
| Sprint | Sprint 2 D6 |
| 上位文書 | `docs/architecture.md` §9/§10 / `docs/requirements.md` §2 Phase 1c |
| 関連文書 | `docs/native-call-bridge.md` v1.4 (CallKit 用途) / `docs/billing-ui-flow.md` v1.2 (IAP) / `docs/notification-detail.md` v1.3 (APNs VoIP Push) / `docs/legal-and-consent.md` (D7) / `docs/production-runbook.md` (D8) |
| 下位実装対象 | App Store Connect 設定 / `apps/mobile/ios/TranCall/PrivacyInfo.xcprivacy` / `apps/mobile/ios/TranCall/Info.plist` / EAS Build 設定 / TestFlight グループ |
| 想定読者 | Sprint 3-4 で iOS App Store 提出を行う engineer + 法務 + PM |

---

## 目次

1. [スコープと位置付け](#1-スコープと位置付け)
2. [用語と前提](#2-用語と前提)
3. [App ID / Capabilities 構成](#3-app-id--capabilities-構成)
4. [Bundle / Provisioning / 証明書管理](#4-bundle--provisioning--証明書管理)
5. [Apple Privacy Manifest (PrivacyInfo.xcprivacy)](#5-apple-privacy-manifest-privacyinfoxcprivacy)
6. [Info.plist 必須キー一覧](#6-infoplist-必須キー一覧)
7. [App Store Connect 設定](#7-app-store-connect-設定)
8. [IAP product 仕様](#8-iap-product-仕様)
9. [ストア素材仕様](#9-ストア素材仕様)
10. [App Review note](#10-app-review-note)
11. [Sensitive permissions 申告](#11-sensitive-permissions-申告)
12. [ATT (App Tracking Transparency) 判定](#12-att-app-tracking-transparency-判定)
13. [段階配信戦略](#13-段階配信戦略)
14. [リジェクト対策・想定リジェクト理由と対処](#14-リジェクト対策想定リジェクト理由と対処)
15. [改訂履歴](#15-改訂履歴)

---

## 1. スコープと位置付け

### 1.1 本書の責務

本書は Sprint 2 D6 として、TranCall を **iOS App Store** に公開するまでに必要な手続き・素材・申告・Review 戦略を **canonical** に確定する。

具体的には次の領域をカバーする:

1. **Apple Developer Program の構成** — App ID / Capabilities / 証明書 / キーチェーン
2. **Apple Privacy Manifest** — iOS 17+ 必須の `PrivacyInfo.xcprivacy` の完全 XML
3. **Info.plist 必須キー** — Usage Description / Background Modes / URL Schemes
4. **App Store Connect 設定** — App ID 登録 → IAP 商品 → TestFlight → 本番審査
5. **ストア素材** — アイコン / スクリーンショット / 説明文 / プレビュー動画 / キーワード
6. **App Review note** — CallKit 用途 / IAP テスト手順 / 翻訳機能デモの説明文
7. **段階配信戦略** — 内部 TestFlight → 外部 TestFlight β → 本番リリースのタイムライン
8. **リジェクト対策** — 想定される審査リジェクト理由と個別対処

### 1.2 スコープ外

| 除外対象 | 理由 |
|---|---|
| **Google Play 提出** | 別 PR で設計予定 (Phase 1c 後半) |
| **Android 固有の申告** | `docs/native-call-bridge.md` §2.2.2 に Android 権限は記載済み |
| **heartbeat 課金のシーケンス** | `docs/billing-detail.md` が canonical |
| **法務・プライバシーポリシー本文** | `docs/legal-and-consent.md` (D7) が canonical |
| **本番インフラ運用** | `docs/production-runbook.md` (D8) が canonical |

### 1.3 関連設計書との位置関係

```
docs/requirements.md           Phase 1c 定義 (BILL-005, NOTIF-003 等)
docs/architecture.md           §9 セキュリティ / §10 CI/CD
docs/module-contracts.md       §2.x BillingFacade / NotificationFacade 契約
docs/native-call-bridge.md     CallKit / PushKit / APNs 実装 canonical
docs/billing-ui-flow.md        IAP StoreKit 2 / External Purchase フロー canonical
docs/notification-detail.md    APNs VoIP Push payload / HMAC 署名 canonical
docs/legal-and-consent.md      プライバシーポリシー・利用規約・同意フロー (D7)
docs/app-store-submission.md   ★本書 (App Store 提出手続き canonical)
docs/production-runbook.md     本番運用・デプロイ手順 (D8)
```

---

## 2. 用語と前提

### 2.1 用語定義

| 用語 | 定義 |
|------|------|
| **Apple Developer Program** | App Store への公開に必要な年額有料プログラム (個人: ¥12,800/年、法人: 同額) |
| **App Store Connect** | Apple が提供するアプリ管理ポータル。App ID 登録・IAP 商品登録・TestFlight・審査提出を行う |
| **Bundle ID** | iOS アプリを一意に識別する逆 DNS 形式の文字列。本書では `tech.hori.trancall` |
| **Provisioning Profile** | Bundle ID + 証明書 + デバイス UDID の組み合わせを封じ込めた Apple 署名ファイル (.mobileprovision) |
| **APNs auth key** | Apple Push Notification service の認証に使う楕円曲線キー (`*.p8`)。1 本で VoIP Push / 通常 Push の両方をカバーできる |
| **VoIP Services Certificate** | APNs の旧 VoIP Push 用証明書 (`*.p12`)。**本プロジェクトでは採用しない** (auth key 方式に統一) |
| **CallKit** | iOS 10+ の VoIP 通話 OS 統合 UI フレームワーク。ロック画面着信 UI / Recents 連携 |
| **PushKit** | VoIP Push 専用受信フレームワーク。kill 状態でも `didReceiveIncomingPushWith` を起動 |
| **PrivacyInfo.xcprivacy** | iOS 17+ 必須の Apple Privacy Manifest。データ収集内容と Required Reason API 使用を宣言する XML |
| **Required Reason API** | iOS が特定 API のアクセス目的申告を義務付けるカテゴリ (UserDefaults / FileTimestamp / SystemBootTime 等) |
| **StoreKit 2** | iOS 15+ の In-App Purchase フレームワーク (Swift-native、JWS 検証付き) |
| **StoreKit External Purchase** | Apple StoreKit External Link Entitlement を用いた外部決済リンク。日本・EU 等の対象国で利用可 |
| **TestFlight** | App Store 公開前のベータ配信サービス。内部 (最大 100 名) と外部 (最大 10,000 名) の 2 種 |
| **EAS Build** | Expo Application Services の managed CI/CD ビルドサービス |
| **ATT** | App Tracking Transparency。iOS 14.5+ 以降、ユーザーをまたいだ追跡を行う場合に事前許可が必要 |
| **Communication Notifications Entitlement** | `com.apple.developer.usernotifications.communication`。SMS 代替アプリ向け。VoIP 通話用途では **不要** かつ付与するとリジェクトリスクになる |

### 2.2 前提条件

| 条件 | 詳細 |
|------|------|
| Apple Developer Program | 加入済みであること (年額 ¥12,800) |
| App Store Connect 組織 | `tech.hori.trancall` Bundle ID が登録済みであること |
| EAS CLI | `npx eas-cli@latest` インストール済み、`eas login` 完了 |
| Xcode | 16.x 以上インストール済み (iOS 18 SDK 同梱) |
| macOS | 14.x (Sonoma) 以上 |
| Ruby | Homebrew 管理の 3.x 系 (`~/.rbenv` または Homebrew PATH 設定済み、CocoaPods が依存) |

### 2.3 Bundle ID 体系

| 環境 | Bundle ID |
|------|-----------|
| 本番 (App Store / TestFlight) | `tech.hori.trancall` |
| Staging (社内 distribution) | `tech.hori.trancall.staging` |

Staging は App Store Connect への登録は任意。社内 Ad Hoc / Enterprise 配信で利用する場合のみ別 App ID を作成する。Phase 1a-1b は本番 Bundle ID の TestFlight 内部配信で完結させることを推奨する。

---

## 3. App ID / Capabilities 構成

### 3.1 必須 Capabilities 一覧

Apple Developer Console (developer.apple.com) の App ID 設定で有効化する Capabilities:

| Capability | 有効化 | 理由 |
|---|---|---|
| **Push Notifications** | 有効 | APNs VoIP Push + 通常 Push を auth key 方式で送受信 |
| **In-App Purchase** | 有効 | Phase 1c StoreKit 2 IAP (Light / Standard / Business プラン) |
| Sign in with Apple | 無効 (将来有効化) | Phase 1 では Supabase Email 認証のみ。Phase 2 で Sign in with Apple 追加時に有効化 |
| Communication Notifications | **無効** | VoIP 音声通話用途には不要。誤って付与すると App Review で `INSendMessageIntent` 実装証跡を要求されリジェクトリスクになる (`docs/native-call-bridge.md` §4.1 参照) |
| Associated Domains | 無効 | Universal Links / Handoff は Phase 1 スコープ外 |
| Background Fetch | 無効 | PushKit VoIP で代替できるため不要 |
| Maps | 無効 | — |

### 3.2 Background Modes (Info.plist)

Xcode の Signing & Capabilities タブではなく `Info.plist` の `UIBackgroundModes` キーで宣言する:

| Background Mode | キー文字列 | 用途 |
|---|---|---|
| Voice over IP | `voip` | PushKit による kill 状態 VoIP Push 受信に必須 |
| Audio, AirPlay, and Picture in Picture | `audio` | 通話中にアプリがバックグラウンドになった際の audio セッション継続 |

**注意**: `location` / `remote-notification` / `fetch` は宣言しない。不要な Background Mode を宣言すると App Review で用途説明が求められる。

### 3.3 Entitlements ファイル構成

`apps/mobile/ios/TranCall/TranCall.entitlements` に記述する:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- APNs 環境: 本番ビルドは production、開発ビルドは development -->
  <key>aps-environment</key>
  <string>production</string>

  <!-- In-App Purchase 有効化 -->
  <!-- IAP は自動的に付与されるが明示記述を推奨 -->
  <!-- com.apple.developer.in-app-payments は不要 (Apple Pay 専用) -->
</dict>
</plist>
```

**重要**: `com.apple.developer.usernotifications.communication` (Communication Notifications) は絶対に含めないこと。

---

## 4. Bundle / Provisioning / 証明書管理

### 4.1 証明書体系

本プロジェクトは **APNs auth key (p8) 単独採用** を確定方針とする。`docs/native-call-bridge.md` §2.2.1 の設計と完全整合する。

| 証明書 / キー | 形式 | 本プロジェクト | 理由 |
|---|---|---|---|
| APNs auth key | `*.p8` (ECDSA-P256) | **採用** | 1 本で VoIP Push + 通常 Push 双方をカバー。有効期限なし、rotation 容易 |
| APNs VoIP Services Certificate | `*.p12` | **不採用** | auth key 方式で代替可能。証明書有効期限管理コストを排除 |
| Apple Distribution Certificate | `*.cer` | 採用 (EAS 管理) | App Store / TestFlight 提出ビルドの署名 |
| Apple Development Certificate | `*.cer` | 採用 (EAS 管理) | ローカル開発・実機デバッグ |

### 4.2 APNs auth key 設定手順

1. developer.apple.com → Certificates, Identifiers & Profiles → Keys → (+)
2. Key Name: `TranCall APNs Key`、Apple Push Notifications service (APNs) にチェック
3. 生成後 `AuthKey_XXXXXXXXXX.p8` をダウンロード (1 回のみ、再ダウンロード不可)
4. **Key ID** と **Team ID** を記録する
5. `apps/server/` の環境変数に設定:
   - `APNS_KEY_ID` = ダウンロードした Key ID (10 文字)
   - `APNS_TEAM_ID` = Apple Developer Team ID (10 文字)
   - `APNS_KEY_PATH` or `APNS_KEY_CONTENT` = `.p8` ファイルパスまたは内容
6. 1Password の `TranCall-Infra` vault に格納する (`docs/deployment-render-dryrun.md` §2.3 1Password vault 構造 canonical 参照)

### 4.3 Provisioning Profile 管理 (EAS 自動管理)

EAS Build の `managed` credential を採用し、Expo が Provisioning Profile の作成・更新・ローテーションを自動管理する。

`apps/mobile/eas.json` の推奨設定:

```json
{
  "cli": {
    "version": ">= 13.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": {
        "simulator": false
      }
    },
    "preview": {
      "distribution": "internal",
      "ios": {
        "buildConfiguration": "Release"
      }
    },
    "production": {
      "autoIncrement": true,
      "ios": {
        "buildConfiguration": "Release"
      }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "<Apple ID メールアドレス、1Password TranCall-Infra vault または環境変数 EXPO_APPLE_ID から取得>",
        "ascAppId": "XXXXXXXXXX",
        "appleTeamId": "XXXXXXXXXX"
      }
    }
  }
}
```

`ascAppId` は App Store Connect → アプリ詳細ページの URL から取得する数字 10 桁。

### 4.4 ローカル EAS Build + TestFlight 提出フロー (4 ステップ)

```bash
# Step 1: 最新 main を pull
git pull origin main

# Step 2: Homebrew Ruby PATH 設定 (CocoaPods が依存)
export PATH="/opt/homebrew/opt/ruby/bin:$PATH"
export GEM_HOME="$(ruby -e 'puts Gem.user_dir')"
export PATH="$GEM_HOME/bin:$PATH"

# Step 3: ローカルビルド (--non-interactive で CI 向け)
npx eas-cli build --platform ios --profile production --local --non-interactive

# Step 4: TestFlight / App Store へ提出
npx eas-cli submit --platform ios --profile production \
  --path ./build-*.ipa --non-interactive
```

**注意**: EAS Build 投入前にローカル検証を必須とする (メモリ FEEDBACK の `EAS Build 前にローカル検証必須` 参照):

```bash
# 型チェックとビルド検証 (EAS に投げる前に必ず実行)
pnpm install --frozen-lockfile
pnpm --filter @trancall/mobile typecheck
pnpm --filter @trancall/mobile build:check
```

---

## 5. Apple Privacy Manifest (PrivacyInfo.xcprivacy)

iOS 17+ で必須化された Privacy Manifest の **完全な canonical 定義**。実 XML を本書に記載する。Sprint 3 で `apps/mobile/ios/TranCall/PrivacyInfo.xcprivacy` に配置する。

### 5.1 収集データ宣言 (NSPrivacyCollectedDataTypes)

TranCall が収集するデータとその用途・リンク可否・追跡用途を宣言する:

| データ種別 (Apple カテゴリ) | Apple 定数 | 収集 | 用途 | ユーザーにリンク | 追跡用途 |
|---|---|---|---|---|---|
| Email Address | `NSPrivacyCollectedDataTypeEmailAddress` | 収集 | App Functionality + Account Management | リンク可 | 不使用 |
| User ID (Supabase user_id) | `NSPrivacyCollectedDataTypeUserID` | 収集 | App Functionality | リンク可 | 不使用 |
| Audio Data (通話音声) | `NSPrivacyCollectedDataTypeAudioData` | 収集 | App Functionality (翻訳のため OpenAI に送信) | **非リンク** | 不使用 |
| Other User Content (transcript テキスト) | `NSPrivacyCollectedDataTypeOtherUserContent` | 収集 | App Functionality | リンク可 | 不使用 |
| Device ID (APNs deviceToken) | `NSPrivacyCollectedDataTypeDeviceID` | 収集 | App Functionality (VoIP Push 配信) | リンク可 | 不使用 |
| Crash Data (Sentry) | `NSPrivacyCollectedDataTypeCrashData` | 収集 | Analytics | 非リンク | 不使用 |
| Performance Data (レイテンシー metrics) | `NSPrivacyCollectedDataTypePerformanceData` | 収集 | Analytics + App Functionality | 非リンク | 不使用 |

**重要な設計判断**:
- Audio Data はユーザーにリンクしない (`NSPrivacyCollectedDataTypeLinked = false`) — 音声は翻訳処理のみに使用し、OpenAI API に送信後に本人と紐付けた形で保存しない
- Crash Data / Performance Data は匿名集計のみ
- 本アプリは ATT の対象となる「追跡」を一切行わない (`NSPrivacyTracking = false`)

### 5.2 Required Reason API 申告 (NSPrivacyAccessedAPITypes)

iOS 17+ 必須申告。使用する API カテゴリとその理由コード:

| API カテゴリ | 使用箇所 | 理由コード | 理由 |
|---|---|---|---|
| `NSPrivacyAccessedAPICategoryUserDefaults` | `expo-secure-store`、Expo SDK 内部、アプリ設定保存 | `CA92.1` | App Functionality (ユーザー設定の読み書き) |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | キャッシュ管理、Expo Image Cache | `C617.1` | App Functionality (キャッシュファイルの鮮度管理) |
| `NSPrivacyAccessedAPICategorySystemBootTime` | Sentry パフォーマンス測定、LiveKit RN SDK 内部 | `35F9.1` | App Functionality (翻訳レイテンシー測定) |
| `NSPrivacyAccessedAPICategoryDiskSpace` | expo-file-system (トランスクリプト export 時の空き容量確認) | `85F4.1` | App Functionality (エクスポート可否判定) |

**Sprint 3 着手時の追加確認事項**:
- LiveKit RN SDK の Privacy Manifest 提供有無を公式リリースノートで確認する
- Sentry SDK が Privacy Manifest を提供しているか確認する (2024 年末時点で提供開始)
- `expo-*` 各種は Expo SDK が統合 manifest を提供するため個別確認不要
- 未対応 SDK がある場合は Sprint 3 内で manifest 自前作成 or SDK アップグレードを行う

### 5.3 SDK Privacy Manifest 対応状況

| SDK | manifest 提供 | 確認要否 |
|---|---|---|
| LiveKit RN SDK (`@livekit/react-native`) | Sprint 3 で確認 | 要確認 |
| Expo SDK 54 (expo-*) | 提供済み (統合 manifest) | 確認済 |
| Sentry (`@sentry/react-native`) | 提供済み (v5.22+ 以降) | バージョン確認要 |
| Firebase / FCM (`@react-native-firebase/messaging`) | 提供済み | 確認済 |
| Stripe Native SDK | **使用しない** (Web Checkout のみ) | 不要 |

未対応 SDK が残った場合の対処:
1. SDK の最新バージョンへのアップグレードを試みる
2. それでも manifest がない場合は `PrivacyInfo.xcprivacy` に手動で該当エントリを追加する
3. Apple が manifest 不足でリジェクトした場合は対処事例として §14 のリジェクト対策に追記する

### 5.4 完全 XML (PrivacyInfo.xcprivacy)

`apps/mobile/ios/TranCall/PrivacyInfo.xcprivacy` の全内容:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>

  <!-- 追跡 (cross-app / cross-website tracking) は行わない -->
  <key>NSPrivacyTracking</key>
  <false/>

  <!-- 追跡ドメインなし -->
  <key>NSPrivacyTrackingDomains</key>
  <array/>

  <!-- Required Reason API 使用宣言 -->
  <key>NSPrivacyAccessedAPITypes</key>
  <array>

    <!-- UserDefaults: アプリ設定・Expo SDK 内部 -->
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>CA92.1</string>
      </array>
    </dict>

    <!-- File Timestamp: キャッシュ管理 -->
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>C617.1</string>
      </array>
    </dict>

    <!-- System Boot Time: Sentry パフォーマンス測定・LiveKit SDK 内部 -->
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategorySystemBootTime</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>35F9.1</string>
      </array>
    </dict>

    <!-- Disk Space: トランスクリプト export 時の空き容量チェック -->
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryDiskSpace</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>85F4.1</string>
      </array>
    </dict>

  </array>

  <!-- 収集データ種別宣言 -->
  <key>NSPrivacyCollectedDataTypes</key>
  <array>

    <!-- メールアドレス: アカウント管理・App Functionality -->
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeEmailAddress</string>
      <key>NSPrivacyCollectedDataTypeLinked</key>
      <true/>
      <key>NSPrivacyCollectedDataTypeTracking</key>
      <false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array>
        <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
        <!-- Apple 公式 NSPrivacyCollectedDataTypePurposes は AppFunctionality / Analytics / DeveloperAdvertising / ThirdPartyAdvertising / ProductPersonalization / Other の 6 種のみ。AccountManagement は非実在のため AppFunctionality に統一 -->
      </array>
    </dict>

    <!-- User ID (Supabase user_id): App Functionality -->
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeUserID</string>
      <key>NSPrivacyCollectedDataTypeLinked</key>
      <true/>
      <key>NSPrivacyCollectedDataTypeTracking</key>
      <false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array>
        <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
      </array>
    </dict>

    <!-- 音声データ: 翻訳のため OpenAI に送信 (非リンク) -->
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeAudioData</string>
      <key>NSPrivacyCollectedDataTypeLinked</key>
      <false/>
      <key>NSPrivacyCollectedDataTypeTracking</key>
      <false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array>
        <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
      </array>
    </dict>

    <!-- Other User Content (transcript テキスト): App Functionality -->
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeOtherUserContent</string>
      <key>NSPrivacyCollectedDataTypeLinked</key>
      <true/>
      <key>NSPrivacyCollectedDataTypeTracking</key>
      <false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array>
        <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
      </array>
    </dict>

    <!-- Device ID (APNs deviceToken): VoIP Push 配信 -->
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeDeviceID</string>
      <key>NSPrivacyCollectedDataTypeLinked</key>
      <true/>
      <key>NSPrivacyCollectedDataTypeTracking</key>
      <false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array>
        <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
      </array>
    </dict>

    <!-- Crash Data (Sentry): Analytics (非リンク) -->
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeCrashData</string>
      <key>NSPrivacyCollectedDataTypeLinked</key>
      <false/>
      <key>NSPrivacyCollectedDataTypeTracking</key>
      <false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array>
        <string>NSPrivacyCollectedDataTypePurposeAnalytics</string>
      </array>
    </dict>

    <!-- Performance Data: Analytics + App Functionality (非リンク) -->
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypePerformanceData</string>
      <key>NSPrivacyCollectedDataTypeLinked</key>
      <false/>
      <key>NSPrivacyCollectedDataTypeTracking</key>
      <false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array>
        <string>NSPrivacyCollectedDataTypePurposeAnalytics</string>
        <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
      </array>
    </dict>

  </array>

</dict>
</plist>
```

### 5.5 Privacy Manifest の Xcode プロジェクト統合

1. Xcode で `apps/mobile/ios/TranCall.xcworkspace` を開く
2. `TranCall` ターゲット → File Inspector → `PrivacyInfo.xcprivacy` を Target Membership に追加
3. `INFOPLIST_FILE` の設定と混同しないこと (`PrivacyInfo.xcprivacy` は別ファイル)
4. `pod install` 後、`Pods` グループ内の各 Pod の manifest も自動的に統合される

---

## 6. Info.plist 必須キー一覧

`apps/mobile/ios/TranCall/Info.plist` に設定する必須キーの完全リスト。`app.json` の `ios.infoPlist` セクションで管理し、EAS Build 時に自動的に merge される。

### 6.1 Usage Description (権限要求文言)

| キー | 値 (ja) | 値 (en) | 値 (zh) | 用途 |
|---|---|---|---|---|
| `NSMicrophoneUsageDescription` | "TranCall は翻訳通話のためマイク音声を OpenAI に送信します。通話設定でいつでもオフにできます。" | "TranCall sends your microphone audio to OpenAI for real-time translation. You can turn this off in call settings." | "TranCall 将您的麦克风音频发送至 OpenAI 进行实时翻译。您可以在通话设置中随时关闭此功能。" | マイク権限要求時に表示 |
| `NSCameraUsageDescription` | "連絡先追加の QR コードスキャンにカメラを使用します。" | "Camera is used to scan QR codes when adding contacts." | "用于扫描添加联系人时的二维码。" | QR コードスキャン |

**注意**:
- iOS は `NSMicrophoneUsageDescription` が空または不十分な場合、App Review でリジェクトされる
- `NSMicrophoneUsageDescription` の文言は「OpenAI に送信する」旨を明示することが `5.1.1 Privacy - Data Collection` 対策として重要
- 多言語化は EAS Build の locale export 機能を使うか、各 `InfoPlist.strings` ファイルで対応する
- `app.json` の `ios.infoPlist` には ja 版の文言を設定し、他言語は `InfoPlist.strings` で上書き

### 6.2 Background Modes

```xml
<key>UIBackgroundModes</key>
<array>
  <string>voip</string>
  <string>audio</string>
</array>
```

§3.2 の説明の通り。`UIBackgroundModes` の各文字列は Apple が定義する固定値。

### 6.3 URL Schemes

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>tech.hori.trancall</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>trancall</string>
    </array>
  </dict>
</array>
```

使用箇所:
- OAuth コールバック (将来の Google / Apple Sign In)
- StoreKit External Purchase 完了後の deep link 復帰 (`trancall://billing/external-success?token=...`)
- Stripe Web Checkout 完了後の deep link 復帰 (`trancall://billing/stripe-success?session_id=...`)

詳細は `docs/billing-ui-flow.md` §8 (StoreKit External Purchase フロー) 参照。

### 6.4 クエリスキーム

```xml
<key>LSApplicationQueriesSchemes</key>
<array>
  <string>mailto</string>
</array>
```

用途: サポート問い合わせフォームからメールアプリを起動するため (`openURL("mailto:support@trancall.app")`)。

### 6.5 暗号化輸出申告

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

TranCall は TLS / SRTP / DTLS によるトランスポート層暗号化のみを使用しており、これらは Apple の輸出規制免除 (Exempt Encryption) に該当する。独自の暗号化アルゴリズムを実装していないため `false` を設定する。

これにより App Store 提出時の **ERN (Encryption Registration Number) の取得が不要**になる。

### 6.6 StoreKit 設定

```xml
<!-- StoreKit 2 は iOS 15+ 自動対応のため特別な Info.plist キーは不要 -->
<!-- App Store Connect での IAP 商品登録のみ必要 (§8 参照) -->
```

### 6.7 app.json への統合例

`apps/mobile/app.json` の `expo.ios.infoPlist` セクション (現在の記述を拡張):

```json
{
  "expo": {
    "ios": {
      "bundleIdentifier": "tech.hori.trancall",
      "supportsTablet": false,
      "infoPlist": {
        "NSMicrophoneUsageDescription": "TranCallは翻訳通話のためマイク音声をOpenAIに送信します。通話設定でいつでもオフにできます。",
        "NSCameraUsageDescription": "連絡先追加のQRコードスキャンにカメラを使用します。",
        "UIBackgroundModes": ["voip", "audio"],
        "ITSAppUsesNonExemptEncryption": false,
        "CFBundleURLTypes": [
          {
            "CFBundleURLName": "tech.hori.trancall",
            "CFBundleURLSchemes": ["trancall"]
          }
        ],
        "LSApplicationQueriesSchemes": ["mailto"]
      }
    }
  }
}
```

---

## 7. App Store Connect 設定

### 7.1 App ID 登録

1. developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → (+)
2. App IDs を選択 → App を選択
3. Description: `TranCall`
4. Bundle ID: `tech.hori.trancall` (Explicit を選択)
5. Capabilities: Push Notifications / In-App Purchase にチェック
6. Register をクリック

App Store Connect (appstoreconnect.apple.com) でのアプリ登録:
1. My Apps → (+) → New App
2. Platform: iOS
3. Name: `TranCall`
4. Primary Language: Japanese (日本語)
5. Bundle ID: `tech.hori.trancall` (ドロップダウンから選択)
6. SKU: `trancall-ios-001` (任意の一意な文字列)
7. User Access: Full Access

### 7.2 アプリ情報の設定

| 項目 | 値 |
|------|-----|
| Category (Primary) | Utilities |
| Category (Secondary) | Productivity |
| Age Rating | 4+ |
| Content Rights | Does not contain, display, or access third-party content |
| License Agreement | Standard EULA (Apple 標準 EULA を使用、カスタム EULA は法務 D7 承認後に変更) |

### 7.3 価格と販売地域

| 項目 | 設定 |
|------|------|
| Base Territory & Price | Japan / ¥0 (無料アプリ、課金は IAP) |
| Available Territories | 全世界 (Phase 1c) |
| Pricing Schedule | 変更なし |

### 7.4 Sandbox Tester アカウント

App Store Connect → Users and Access → Sandbox の Testers タブで作成する。

**最低限必要な Sandbox テスターアカウント** (5 名):

| アカウント名 | 用途 |
|---|---|
| `sandbox.free@trancall.app` | Free プラン確認・購入前状態 |
| `sandbox.light@trancall.app` | Light プラン (¥980) 購入テスト |
| `sandbox.standard@trancall.app` | Standard プラン (¥2,980) 購入・アップグレードテスト |
| `sandbox.business@trancall.app` | Business プラン (¥9,800) 購入テスト |
| `sandbox.restore@trancall.app` | Restore Purchases テスト |

Sandbox での課金は実際には請求されない。Apple Sandbox は通常 5 分でサブスクリプション更新をシミュレートする。

詳細な Sandbox テスト手順は `docs/billing-ui-flow.md` §14.4 参照。

---

## 8. IAP product 仕様

`docs/billing-ui-flow.md` §7 (iOS App Store IAP フロー) と整合する IAP 商品の App Store Connect 設定。

### 8.1 Subscription Group 設定

| 設定項目 | 値 |
|---|---|
| Subscription Group 名 | `TranCall Subscription` |
| Reference Name | `trancall-subscription-group` |

### 8.2 IAP 商品一覧

| productId | 表示名 (ja) | 表示名 (en) | 価格 (税込) | 含有分数 | 種別 | ランク |
|---|---|---|---|---|---|---|
| `com.trancall.subscription.light.monthly` | Light Monthly | Light Monthly | ¥980 | 30 分 | Auto-Renewable Subscription | 1 |
| `com.trancall.subscription.standard.monthly` | Standard Monthly | Standard Monthly | ¥2,980 | 120 分 | Auto-Renewable Subscription | 2 |
| `com.trancall.subscription.business.monthly` | Business Monthly | Business Monthly | ¥9,800 | 500 分 | Auto-Renewable Subscription | 3 |

**注意事項**:
- Free プランは IAP 商品として登録しない (アカウント作成時に自動付与)
- productId の命名規則: `com.trancall.subscription.{tier}.monthly` (`docs/billing-ui-flow.md` §4.4 `IapTransactionResultSchema` と整合)
- Subscription Group のランクはアップグレード/ダウングレードの方向性を Apple が判定するために使用する (数値が大きいほど上位プラン)
- 将来の年払いプランは `com.trancall.subscription.{tier}.annual` として別 productId で登録する (Phase 2 以降)

### 8.3 各 IAP 商品の App Store Connect 登録項目

App Store Connect → My Apps → TranCall → In-App Purchases → Subscriptions で設定:

**Light Monthly (`com.trancall.subscription.light.monthly`)**:
- Reference Name: `Light Monthly`
- Product ID: `com.trancall.subscription.light.monthly`
- Duration: 1 Month
- Price: ¥980 (Tier 10 相当)
- Localization: 日本語 / 英語 / 中国語 (簡体字) の表示名・説明文を登録
- Promotional Offer: なし (Phase 1)
- Free Trial: なし (Free プランが実質の試用版)
- Review Screenshot: 購入フロー全体を示すスクリーンショット 1 枚 (§10 の App Review note に詳細記載)

### 8.4 Server Notification の設定

App Store Connect → My Apps → TranCall → App Information → App Store Server Notifications:

| 項目 | 値 |
|---|---|
| Production Server URL | `https://trancall.app/api/billing/webhook/apple` |
| Sandbox Server URL | `https://staging.trancall.app/api/billing/webhook/apple` |
| Notification Version | Version 2 (SIGNED_TRANSACTION_INFO 形式の JWS) |

Server Notification を受信して subscription 状態を DB に反映する処理は `apps/server/src/routes/billing.ts` の `POST /api/billing/webhook/apple` エンドポイントが担う。詳細は `docs/billing-ui-flow.md` §7 参照。

### 8.5 StoreKit External Purchase Entitlement (日本・EU 向け)

`docs/billing-ui-flow.md` §8 (StoreKit External Purchase フロー) 参照。App Store Connect での追加設定:

- My Apps → TranCall → App Information → External Purchase Links → Enable
- 対象地域: 日本 (JP) / EU 加盟国 / 韓国 (KR) / インド (IN)
- ランディング URL: `https://trancall.app/subscription` (Stripe Checkout Session 発行ページ)
- 表示文言: Apple 指定テンプレートに従う (`docs/billing-ui-flow.md` §8.3 の required disclosure 文言参照)

---

## 9. ストア素材仕様

### 9.1 アプリアイコン

| 仕様 | 詳細 |
|------|------|
| サイズ | 1024×1024 px |
| フォーマット | PNG (alpha チャンネルなし) |
| 出典 | `packages/ui-kit/assets/trancall-icon.svg` を export |
| 角丸処理 | App Store Connect が自動適用 (アップロード時に角丸 mask なしの正方形 PNG をそのまま使用) |
| セーフゾーン | 全体の 10% (102 px) を内側に確保 (Apple HIG Icon Grid 準拠) |

**生成手順**:

```bash
# trancall-icon.svg を 1024x1024 PNG に変換
# rsvg-convert (librsvg) または Figma / Sketch のエクスポートを使用
rsvg-convert -w 1024 -h 1024 packages/ui-kit/assets/trancall-icon.svg \
  -o apps/mobile/assets/icon-1024.png

# alpha チャンネルを除去 (重要: alpha ありは App Store Connect でリジェクトされる)
convert apps/mobile/assets/icon-1024.png \
  -background white -alpha remove -alpha off \
  apps/mobile/assets/icon-1024-no-alpha.png
```

Expo は `app.json` の `expo.icon` で指定した画像から各サイズ (20〜1024 px) の Asset Catalog エントリを自動生成する。

### 9.2 スクリーンショット

iOS App Store での 2026 年時点の必須サイズ:

| デバイス | 解像度 | 枚数 | 必須 |
|---|---|---|---|
| 6.9" (iPhone 16 Pro Max) | 1320×2868 px | 3〜10 枚 | 必須 (最新機種) |
| 6.7" (iPhone 15 Pro Max / 16 Plus) | 1290×2796 px | 3〜10 枚 | 必須 |
| 6.5" (iPhone XS Max / 11 Pro Max) | 1242×2688 px | 3〜10 枚 | 必須 |
| 5.5" (iPhone 8 Plus 互換) | 1242×2208 px | 3〜10 枚 | オプション |

**注意**: 6.7" のスクリーンショットは 6.5" との共用が可能な場合があるが、App Store Connect の表示で自動スケール処理が入る。正確な表示のため各サイズを個別に用意することを推奨する。

#### 撮影シナリオ (推奨 6 枚構成)

| 枚 | シナリオ | 内容 |
|---|---|---|
| 1 | Onboarding — 価値訴求 | 「すべての通話を、自分の言語で。」のメインビジュアル。翻訳通話のコンセプトを視覚的に訴求 |
| 2 | Home — 通話履歴 | 通話履歴一覧 + 残量バッジ (`残り 25 分 (Light)`) が見える状態 |
| 3 | Pre-call — コスト見積 | 発信前の翻訳設定画面。語ペア (JA → EN) + コスト見積もり表示 |
| 4 | In-call + 字幕 | 通話中の字幕 overlay 表示。翻訳リアルタイム字幕が核心価値として伝わること |
| 5 | Call Summary | 通話後のサマリー。時間・コスト・トランスクリプト概要 |
| 6 | Settings — Subscription | プラン管理画面。4 プラン比較表示 (PlanCard コンポーネント) |

**撮影時の注意事項**:
- スクリーンショットは実際のアプリ動作と一致すること (合成はガイドライン `2.3.1 Accurate Metadata` 違反)
- ステータスバーの時刻は `9:41` に固定 (Apple HIG 推奨時刻)
- 通知バナーや他アプリのアイコンが映り込まないよう Simulator で撮影するか `xcrun simctl status_bar` で制御する
- 各スクリーンショットに 72〜180 文字の短い説明キャプションを App Store Connect で設定する (プロモーションテキストは言語別に設定)

### 9.3 説明文

| 項目 | ja | en | zh |
|---|---|---|---|
| **App Name** | TranCall | TranCall | TranCall |
| **Subtitle** (30 字以内) | すべての通話を自分の言語で | Every call in your language | 用您的语言通话 |
| **Description** (4000 字) | Sprint 3 でコピーライター仕上げ | 同左 | 同左 |
| **Keywords** (100 字) | 翻訳,通話,VoIP,リアルタイム,英語,中国語,韓国語,海外通話,翻訳電話 | translation,call,voip,realtime,multilingual,language | 翻译,通话,实时,多语言,跨语言 |
| **What's New** (4000 字) | Sprint 4 で記入 | 同左 | 同左 |
| **Support URL** | `https://trancall.app/support` | 同左 | 同左 |
| **Marketing URL** | `https://trancall.app` | 同左 | 同左 |
| **Privacy Policy URL** | `https://trancall.app/privacy` | 同左 | 同左 |

**Description 執筆の指針** (Sprint 3 コピーライター向け):

1. 冒頭 3 行以内でコア価値 (リアルタイム翻訳通話) を伝える
2. 具体的なユースケース: ビジネス交渉、海外家族との通話、語学学習
3. 技術的な信頼性: OpenAI Realtime Translation API (model: gpt-realtime-translate) によるリアルタイム翻訳、低遅延 (p95 3 秒)、字幕表示
4. プライバシーへの配慮: 音声データの用途を透明に説明
5. プラン構成: Free 5 分から試せることを強調
6. CallKit 統合: iOS 標準着信 UI との統合を技術差別化として訴求

### 9.4 プレビュー動画 (任意、強く推奨)

| 仕様 | 詳細 |
|------|------|
| 長さ | 15〜30 秒 |
| フォーマット | H.264、最大 500 MB |
| 解像度 | スクリーンショットと同じデバイスサイズで録画 |
| 音声 | 任意 (App Store は音声なしで自動再生されることを考慮) |

**撮影シナリオ**: 日本語話者 (JA) が英語ネイティブ (EN) と通話。字幕が日本語 ⇄ 英語でリアルタイム表示される流れ。CallKit 着信 UI からの応答シーンを冒頭に入れると iOS 統合の高さを視覚的にアピールできる。

---

## 10. App Review note

Apple App Review チームへの提出時に Notes フィールドに記載する説明文。CallKit の正当な VoIP 用途であること、IAP のテスト手順、翻訳機能のデモ方法を明確に説明する。

### 10.1 English (必須)

```
Thank you for reviewing TranCall.

TranCall is a real-time translation VoIP calling app powered by OpenAI's
OpenAI Realtime Translation API (model: gpt-realtime-translate). When two users speak different languages, their
voices are translated in real-time and delivered as translated audio, with
live subtitles shown on screen.

──────────────────────────────────────────────
1. CallKit / VoIP Usage
──────────────────────────────────────────────
We use CallKit and PushKit exclusively for VoIP audio calling.

- CallKit is used to display the native iOS incoming call UI when a VoIP
  call arrives (even from a locked/killed state).
- PushKit is used to receive VoIP Push notifications (APNs push-type: voip)
  that trigger the CallKit incoming call UI.
- We do NOT use CallKit for SMS, push notifications, or any non-call purpose.
- We do NOT use the Communication Notifications entitlement.
- CallKit is configured for voice calls only (`CXProvider.configuration.supportsVideo = false`). Video calling is not supported in Phase 1.
- This is the standard/legitimate use case described in Apple's CallKit
  documentation for VoIP communication apps.

Background modes declared: "voip" (required for PushKit) and "audio"
(required to continue audio when the app goes to background during a call).

──────────────────────────────────────────────
2. Voice Transmission & Privacy
──────────────────────────────────────────────
- During a translation call, user voice is transmitted to OpenAI's
  Realtime Translation API for real-time translation.
- On first use, we show a consent screen explaining that voice is sent to
  OpenAI. Translation is off by default if consent is declined.
- Privacy Policy: https://trancall.app/privacy
- Users can disable translation at any time during a call.

──────────────────────────────────────────────
3. In-App Purchase / Subscription Testing
──────────────────────────────────────────────
Test accounts (App Store Sandbox):
  Email: sandbox.light@trancall.app
  Password: [provided separately in the Review Notes secure field]

Steps to test subscription purchase:
  1. Launch app → **Sign in** with the sandbox account above (the account is pre-created in App Store Connect → Users and Access → Sandbox)
  2. Tap Settings tab → Subscription
  3. Select "Light Monthly" (¥980) → Tap "Subscribe"
  4. Confirm purchase in the StoreKit dialog
  5. Subscription activates immediately; remaining minutes update to 30 min

Steps to test Restore Purchases:
  1. Settings → Subscription → "Restore Purchases"
  2. Confirm original subscription is restored

All IAP transactions run in App Store Sandbox — no real charge is made.

──────────────────────────────────────────────
4. Translation Feature Demo
──────────────────────────────────────────────
To demonstrate real-time translation:
  1. You will need two test devices (or one device + Simulator)
  2. Sign in with different accounts on each device
  3. Add each other as contacts via TranCall ID
  4. Set native language to "Japanese" on one, "English" on the other
  5. Start a call — translation activates automatically
  6. Live subtitles appear: original + translated text in real-time

If a second device is unavailable, the translation pipeline can be
demonstrated by starting a call to our internal test account:
  Test contact TranCall ID: @review_test_en
  (This account will auto-answer and speak pre-recorded English phrases)

──────────────────────────────────────────────
5. Additional Notes
──────────────────────────────────────────────
- Free plan: 5 minutes of translation included (no payment required to test)
- Translation is skipped entirely for same-language calls (no API charge)
- The app requires microphone permission; camera is only for QR code scanning
  when adding contacts
- No location data is collected or used

If you have any questions or encounter issues during review, please contact:
  support@trancall.app

Thank you.
```

### 10.2 日本語版 (補足参考)

App Review note は英語が必須。日本語版は PM / 法務の確認用として以下を作成しておく:

```
TranCall のレビューをありがとうございます。

TranCall は OpenAI Realtime Translation API (model: gpt-realtime-translate) を利用したリアルタイム翻訳
VoIP 通話アプリです。異なる言語を話すユーザー同士が通話すると、音声が
リアルタイムで翻訳・配信され、字幕が画面に表示されます。

1. CallKit / VoIP の用途
   - CallKit / PushKit は VoIP 音声通話専用です
   - SMS・プッシュ通知・非通話目的での CallKit 使用はありません
   - Communication Notifications entitlement は使用しません
   - これは Apple CallKit ドキュメントが定める正当な VoIP アプリ用途です

2. 音声送信とプライバシー
   - 翻訳通話中、ユーザー音声は翻訳のため OpenAI に送信されます
   - 初回使用時に同意画面を表示します
   - 通話中いつでも翻訳をオフにできます

3. IAP テスト手順
   - サンドボックスアカウント: sandbox.light@trancall.app
   - Settings → Subscription → Light Monthly を選択 → 購入
   - Restore は Settings → Subscription → "Restore Purchases" で確認可能

4. 翻訳機能のデモ
   - 2 台のデバイスで言語を「日本語」「英語」に設定して通話を開始
   - 1 台のみの場合はテスト連絡先 @review_test_en に発信してください

ご不明な点は support@trancall.app までご連絡ください。
```

---

## 11. Sensitive permissions 申告

### 11.1 App Store Review Guideline 対応マトリクス

| ガイドライン | 項目 | 対応内容 |
|---|---|---|
| `4.1 Copycats` | 最小機能要件 | リアルタイム翻訳 + 字幕 + トランスクリプト + IAP の組み合わせで明確な独自価値を訴求 |
| `4.2 Minimum Functionality` | アプリとしての価値 | 通話・翻訳・字幕・トランスクリプト・プラン管理の 5 機能軸を Review note §4 で列挙 |
| `5.1.1 Privacy - Data Collection` | データ収集の透明性 | Privacy Manifest (§5) + Privacy Policy (D7) + 初回同意画面 (AUTH-009) で三重担保 |
| `5.1.2 Data Use and Sharing` | OpenAI への音声送信 | Privacy Policy に明記 + マイク権限要求文に「OpenAI に送信」を明示 (§6.1) |
| `5.4 VoIP` | CallKit の正当な VoIP 用途 | §10.1 Review note の Section 1 で詳細説明 |
| `3.1.1 In-App Purchase` | IAP 実装の準拠 | StoreKit 2 採用・Restore Purchases 実装 (`docs/billing-ui-flow.md` §12) |
| `1.1.6 User Spam` | 匿名通話防止 | email verification 必須 (CONTACT-011) |

### 11.2 マイク権限 (NSMicrophoneUsageDescription) 申告

マイク権限の Usage Description には「OpenAI に送信する」旨を含めること (§6.1 参照)。

申告の要点:
- **用途**: 音声通話 + リアルタイム翻訳 (OpenAI API への送信)
- **制御方法**: 通話中に翻訳オフにすれば OpenAI への送信停止
- **ユーザー同意**: 初回翻訳通話前に同意画面 (AUTH-009、`docs/legal-and-consent.md` D7 参照)
- **保存ポリシー**: 音声そのものはサーバーに保存しない。トランスクリプト (テキスト) のみ保存

### 11.3 カメラ権限 (NSCameraUsageDescription) 申告

- **用途**: 連絡先追加時の QR コードスキャンのみ
- **音声との分離**: 通話中にカメラを使用しない
- **許可タイミング**: QR スキャン機能を初めて利用したときのみ権限要求 (事前要求不可)

### 11.4 VoIP Push (PushKit) の申告

App Store Review Guideline `4.5.4 Push Notifications` 対応:
- PushKit VoIP Push は通話着信の専用経路として使用
- 着信以外の目的 (マーケティング通知等) での VoIP Push 使用は行わない
- VoIP Push payload の HMAC 署名で不正なペイロードを排除 (`docs/notification-detail.md` §3 参照)

---

## 12. ATT (App Tracking Transparency) 判定

### 12.1 ATT 対象外と判断する根拠

TranCall は **ATT の対象外** (= `NSUserTrackingUsageDescription` キーの追加と ATT プロンプトの表示は不要) と判断する。

Apple の ATT 要件は「**他の会社のアプリやウェブサイトにわたるユーザーまたはデバイスのトラッキング**」を行う場合に適用される。

TranCall が行うデータ収集の全内容:

| データ | 目的 | 他社アプリ/サイトと共有 | 追跡目的 |
|---|---|---|---|
| メールアドレス / user_id | アカウント管理・認証 | 共有なし | なし |
| 通話音声 | OpenAI リアルタイム翻訳 | OpenAI API にストリーミング送信 (翻訳処理のみ) | なし |
| トランスクリプト | ユーザー本人の閲覧・エクスポート | 共有なし | なし |
| APNs deviceToken | VoIP Push 配信 | 共有なし | なし |
| Crash / Performance | Sentry (匿名集計) | Sentry にのみ送信、広告ネットワーク等への共有なし | なし |

**結論**: ユーザーをまたいで識別したり、広告ターゲティング目的でデータを共有したりする要素が存在しないため、ATT プロンプトは不要。

### 12.2 Privacy Manifest との整合

§5 の `NSPrivacyTracking = false` / `NSPrivacyTrackingDomains = []` の宣言と一致する。

### 12.3 将来の変更に備えた注意事項

以下の機能を追加する場合は ATT 再判定が必要:
- 広告 SDK の導入 (Facebook Audience Network、Google AdMob 等)
- ユーザー行動データを外部の広告プラットフォームへの連携
- サードパーティアナリティクス (Amplitude、Mixpanel 等) のフィンガープリント機能の使用

---

## 13. 段階配信戦略

### 13.1 全体フロー

```
Phase 1a 完了 (LiveKit + 翻訳 + foreground 通話 MVP)
         │
         ▼
TestFlight 内部配信 ─────────────────────────── 1〜2 週間
  ├─ 対象: 開発者 + 内部 QA (最大 100 名)
  ├─ Apple ID 紐付け必須 (App Store Connect → TestFlight → Internal Testing)
  ├─ Beta App Review 不要 (即座に配信可能)
  └─ 確認項目: CallKit 着信・翻訳レイテンシー・IAP サンドボックス・Restore Purchases
         │
         ▼ Phase 1b 完了 (VoIP Push / Kill 状態着信 / Bluetooth)
         │
         ▼
TestFlight 外部 β 配信 ──────────────────────── 2〜4 週間
  ├─ 対象: 招待 (社外ユーザー、最大 10,000 名まで可、Phase 1b では 100 名程度を想定)
  ├─ Beta App Review 必要 (通常 1〜3 営業日)
  ├─ 招待方法: 外部テスターグループに Apple ID を追加 or Public Link (最大 10,000 名)
  └─ フィードバック収集・クラッシュレポート確認 (Sentry)
         │
         ▼ フィードバック反映 + Phase 1c 完了 (Stripe / IAP / プラン管理 UI)
         │
         ▼
App Store 本番審査提出
  ├─ 審査期間: 通常 1〜7 日 (初回は長め、リジェクト 1〜2 回を想定してスケジューリング)
  ├─ §10 の Review note を必ず記入
  └─ §14 のリジェクト対策を事前に確認
         │
         ▼ 審査通過
         │
         ▼
本番リリース (手動リリース or 自動リリース)
  ├─ 初回: 手動リリース (Release This Version を明示的にクリック)
  └─ 段階的リリース (Phased Release): 7 日間で 1%→2%→5%→10%→20%→50%→100% の自動展開
```

### 13.2 TestFlight グループ構成

| グループ | 配信対象 | 配信タイミング | Beta App Review |
|---|---|---|---|
| Internal Testing | 開発者 + 内部 QA 最大 100 名 (Apple ID 紐付け) | Phase 1a 完了直後 | 不要 |
| External Testing β | 招待 (社外、最大 10,000 名、Phase 1b では 100 名想定) | Phase 1b 完了後 | 必要 (1〜3 営業日) |
| Public Link Beta | URL 招待 最大 10,000 名 | Phase 1c 直前 (任意) | 必要 |

**Public Link Beta の判断基準**: β フィードバック収集を最大化したい場合のみ有効化する。External Testing グループで十分な場合は不要。

### 13.3 ビルド番号管理

EAS Build の `autoIncrement: true` 設定で CFBundleVersion を自動インクリメントする。バージョン体系:

| バージョン | 用途 |
|---|---|
| CFBundleShortVersionString | Semantic Versioning (`1.0.0`) — App Store Connect での表示バージョン |
| CFBundleVersion | ビルド番号 (整数、EAS が自動インクリメント) — TestFlight 内でのビルド識別 |

`eas.json` の `"autoIncrement": true` を `production` profile に設定することで EAS Build 毎に自動でインクリメントされる。

### 13.4 リリース後の即時対応フロー

本番リリース後の障害対応は `docs/production-runbook.md` (D8) に canonical 化する。緊急ロールバックが必要な場合は App Store Connect → Phased Release の「Pause」で展開を一時停止できる (既にダウンロード済みのユーザーには影響しない)。

---

## 14. リジェクト対策・想定リジェクト理由と対処

### 14.1 想定リジェクト一覧

| Apple リジェクト理由 | 発生確率 | 対処方法 |
|---|---|---|
| `2.5.4 CallKit Misuse` | **高** | §10.1 Review note Section 1 で VoIP 通話専用用途を詳細説明。CallKit を SMS / 非通話目的で使っていないことを明示 |
| `5.1.1 Privacy - Data Collection and Storage` | **中** | Privacy Manifest (§5) 完備 + Privacy Policy URL 登録 (D7) + マイク権限文言に「OpenAI に送信」明記 (§6.1) |
| `5.1.2 Data Use and Sharing` | **中** | 初回翻訳同意画面 (AUTH-009) + Privacy Policy の第三者送信 (OpenAI) 開示 + Review note §2 で説明 |
| `3.1.1 In-App Purchase` | **低** | StoreKit 2 正式実装 + Restore Purchases 実装 (`docs/billing-ui-flow.md` §12) + サンドボックステストアカウント提供 (§7.4) |
| `4.2 Minimum Functionality` | **低** | Review note §4 で翻訳通話・字幕・トランスクリプト・プラン管理の 4 機能軸を列挙。Free プランで試用可能であることを強調 |
| `4.5.4 Push Notifications` | **低** | PushKit VoIP Push は通話着信専用。Review note §5 で用途を明示 |
| `5.1 Privacy` | **低〜中** | PrivacyInfo.xcprivacy 完備 + Privacy Manifest 提出時の Apple privacy report でデータ整合性を確認 |
| `2.3.1 Accurate Metadata` | **低** | スクリーンショットは実際のアプリ動作のもの。合成・加工は最小限に留める |
| `PrivacyInfo.xcprivacy 不整合` | **中** | Sprint 3 着手前に Privacy Manifest Verifier ツールで整合性確認 (Xcode 15+ の Product → Generate Privacy Report) |

### 14.2 CallKit リジェクト対策の詳細

`2.5.4 CallKit Misuse` は翻訳 + CallKit という組み合わせが審査チームに馴染みが少なく発生確率が高い。

**事前対策**:
1. Review note の §1 (CallKit Usage) を必ず記入 (§10.1 参照)
2. 「SMS に CallKit を使っていない」「非通話通知に CallKit を使っていない」を明示
3. TestFlight β で実際に CallKit 着信 UI が動作する動画を Attachment として添付することを検討
4. `CXProvider.configuration.supportsVideo = false` (Phase 1 は音声のみ) を Review note で説明

**リジェクト後の対処**:
1. Apple のリジェクトメッセージに記載された具体的な懸念点を確認
2. 不明点は Resolution Center で App Review チームに質問 (24〜48 時間で返信)
3. 追加説明文を付けて再提出 (コードの変更なしに Review note の更新のみで解決することが多い)

### 14.3 Privacy Manifest 不整合リジェクト対策

iOS 17+ 以降、App Store は Privacy Manifest の整合性をビルド提出時に検証する。

**Xcode での事前確認手順**:

```bash
# Xcode Archive を作成後に Privacy Report を生成
# Xcode → Product → Archive → Validate → Generate Privacy Report
# JSON 形式で収集データ・API 使用が出力される
# 本書 §5 の宣言内容と一致することを確認する
```

**よくある不整合ケース**:
- 依存 SDK が `NSPrivacyAccessedAPICategoryUserDefaults` を使用しているのに manifest に宣言されていない
- 新規 SDK 追加時に manifest を更新し忘れる
- `NSPrivacyCollectedDataTypeLinked` の true/false が Privacy Policy と不一致

**対策**: SDK バージョンアップ時は必ず Privacy Report を再生成して差分確認する。CI パイプラインに Xcode Privacy Report 生成ステップを追加することを推奨する。

### 14.4 IAP リジェクト対策の詳細

`3.1.1 In-App Purchase` リジェクトを防ぐための必須実装:

1. **Restore Purchases ボタンの設置**: Settings → Subscription 画面に Restore Purchases ボタンを設ける (`docs/billing-ui-flow.md` §12 参照)
2. **購入完了後の即時反映**: `Transaction.updates` で非同期に購入完了を受信し、UI に即時反映する
3. **失効・更新の処理**: サブスクリプション期限切れ・更新失敗 (grace period) を適切に処理
4. **家族共有非対応の明示**: Family Sharing は Phase 1 でサポートしない。App Store Connect で Family Sharing を無効化する

### 14.5 リジェクト対応のタイムライン見積

| フェーズ | 想定期間 |
|---|---|
| 初回審査 | 2〜7 日 |
| リジェクト → 修正 → 再提出 | 3〜5 日 |
| 再審査 | 1〜3 日 |
| 計 (リジェクト 1 回想定) | **最大 2 週間** |

Phase 1c のスケジュールに本番リリースまで **最大 2 週間のバッファ**を確保すること。

---

## 15. 改訂履歴

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| v1.0 | 2026-05-12 | 堀大輔 | Sprint 2 D6 設計書 初版。Scope: App ID / Capabilities / Privacy Manifest 完全 XML / Info.plist 必須キー / App Store Connect 設定 / IAP product (`com.trancall.subscription.{tier}.monthly`) / TestFlight グループ / ストア素材仕様 (6.7"/6.9" 両対応) / App Review note (英語・日本語) / Sensitive permissions / ATT 対象外判定 / 段階配信戦略 / リジェクト対処。Apple iOS 17+ Privacy Manifest 必須化に対応、CallKit 用途審査リスク低減策を §10/§14 で明示。`docs/native-call-bridge.md` v1.4 (p8 単独採用・CallKit entitlement 設計) / `docs/billing-ui-flow.md` v1.2 (StoreKit 2 / External Purchase / Restore Purchases / productId 命名規則) / `docs/notification-detail.md` v1.3 (APNs VoIP Push) / `apps/mobile/app.json` (bundle ID `tech.hori.trancall`) と整合確認済。 |
| v1.1 | 2026-05-12 | 堀大輔 | Round 1 レビュー (Opus A/B/C 並列) 指摘 Critical 3 + Major 4 + Warning 4 を反映。**Critical**: (B C-1) §4.2 1Password vault 名を `TranCall Production Secrets` から `TranCall-Infra` に修正、参照を `deployment-render-dryrun.md §13.2` から `§2.3` に修正。(C C-1) §5.4 Privacy Manifest XML から非実在定数 `NSPrivacyCollectedDataTypePurposeAccountManagement` を削除し AppFunctionality に統一 (Apple 公式 NSPrivacyCollectedDataTypePurposes は 6 種のみ)。(C C-2) §3.3 / §8.5 に `com.apple.developer.storekit.external-purchase` entitlement 申請 (リードタイム 2-4 週、Sprint 3 Week 1 申請推奨) を補足予定 (本 v1.1 は §10.1 のみ反映、§3.3 / §8.5 詳細は v1.2 で別途追補)。**Major**: (A M-2 / C-section) §10.1 Review note Section 1 に「CallKit is configured for voice calls only (`supportsVideo = false`). Video calling is not supported in Phase 1.」を追加。(B W-1) §4.3 eas.json サンプルの実 Apple ID `nvidia.homeftp.net@gmail.com` をプレースホルダーに変更 (1Password TranCall-Infra vault または環境変数 EXPO_APPLE_ID 参照)。**Warning/Minor**: (C W-1) §11.1 / §14.1 の `(§12)` を `(docs/billing-ui-flow.md §12)` に統一。(C W-2) §13 外部 TestFlight 人数を「100 名」から「最大 10,000 名 (Phase 1b 想定 100 名)」に修正。(C W-3) Review note 英語版 "Sign up" を "Sign in" に修正 (sandbox account は事前作成のため sign in が正)。(C W-4) "GPT-Realtime-Translate API" を "OpenAI Realtime Translation API (model: gpt-realtime-translate)" に統一。 |
