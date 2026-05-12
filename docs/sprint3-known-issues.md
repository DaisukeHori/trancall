# Sprint 3 既知の同期事項 (T-29 補足)

このドキュメントは Sprint 3 Week 1-2 実装過程で発見された設計書・実装間の不整合を集約する。
最重要 3 件 (production-runbook §3.1/§3.3、module-contracts §2.6) は T-29 で canonical 設計書に既に反映済 (`production-runbook.md` v1.3, `module-contracts.md` v1.4.0)。本ドキュメントには Sprint 4 以降の対応が必要な事項を記録する。

## 1. 既に T-29 で修正済 (canonical 反映完了)

| # | 内容 | 反映先 |
|---|---|---|
| 1 | serverless-http v3 は Vercel 非互換 → `app.server.emit("request", req, res)` パターンへ修正 | `production-runbook.md` §3.1 (v1.3) |
| 2 | §3.3 Sprint 3 Day 1 Spike 不要、Fastify v4/v5 両対応 | `production-runbook.md` §3.3 (v1.3) |
| 3 | `exportTranscript` 戻り型に `filename` 追加 | `module-contracts.md` §2.6 (v1.4.0) |

## 2. Sprint 3 後半 / Sprint 4 で対処する事項

### 2.1 anonymize UUID 衝突 3 案 (T-2 / T-23 連動)

`docs/account-deletion.md` line 44-51 に記録済の 3 案 (per-user 固定 UUID 派生 / UNIQUE 緩和 / archive table) から最終方針を確定する。退会フロー (T-23) UI は実装済だが、サーバー側の anonymize ロジックは未確定。

**対処タイミング**: Sprint 4 で退会 API (`POST /api/account/delete`) のサーバー実装時に方針を確定。

### 2.2 IAP adapter 2 実装統合 (T-7 連動)

- `packages/billing/src/adapters/apple-iap-adapter.ts` (Webhook 処理、旧 productId 形式 `trancall_light_monthly`)
- `packages/billing/src/adapters/iap-adapter.ts` (StoreKit 2 Transaction 検証、canonical `com.trancall.subscription.light.monthly`)

両 adapter に JSDoc TODO は記録済。Sprint 4 で canonical 形式 (`com.trancall.subscription.*.monthly`) に統合する。

**対処タイミング**: Sprint 4。

### 2.3 `apps/server/src/config.ts` 関連

| 項目 | 状態 |
|---|---|
| `IAP_APPLE_BUNDLE_ID` / `IAP_APPLE_TEAM_ID` | Apple JWS 検証は Phase 1b。Phase 1a では不要 |
| `FCM_PROJECT_ID` | `notification-adapters.ts` で `"trancall"` hardcode 中。functional impact なし。Sprint 4 で env 化推奨 |

### 2.4 `transcript-routes.test.ts` mock 更新済 (T-10 内で対処済)

T-9 Round 2 で指摘された mock 501 が `ok({contentBase64, mime, filename})` に更新されていることを T-10 内で実施済。本項目はクローズ。

### 2.5 `AUTH_CONSENT_REVOKE_FORBIDDEN` (T-10 暫定コード)

T-10 が `apps/server/src/middleware/error-handler.ts` に追加した `AUTH_CONSENT_REVOKE_FORBIDDEN: 403` は canonical `AUTH_CONSENT_IRREVOCABLE: 422` と重複。実コードパスでは未到達 (T-6 facade が `AUTH_CONSENT_IRREVOCABLE` を返す)。Sprint 4 で error-handler.ts から削除推奨。

### 2.6 `/internal/translation/heartbeat` 未実装

`docs/api-spec.md` で定義されているが T-10 スコープ外として未実装。Sprint 3 後半で Vercel/Render 経由 heartbeat 通知用に別タスクとして実装する。

### 2.7 EventBus DomainEvent union に Translation 系イベント追加

T-14 で `TranslationDegradedEvent` / `TranslationRecoveredEvent` を `packages/translation/src/schemas.ts` に追加したが、`apps/server/src/adapters/event-bus.ts` の `DomainEvent` union への追加 + `agent-routes.ts` での `EventBus.publish` 呼び出し追加が未実施。

**対処タイミング**: Sprint 3 後半、agent-routes.ts に publish 呼び出しを追加する別タスクで対処。

### 2.8 support inquiry body 文字数

T-24 実装で `maxLength={1000}` 採用、サーバー側 `SupportInquirySchema` は `max(5000)`。設計書 `support-flow.md` §4.3 ワイヤーフレームは 5000 文字、タスク仕様は 1000 文字と食い違い。

**対処方針**: Sprint 4 で 5000 文字に統一 (canonical 設計書優先)。

### 2.9 PreCallCostEstimate `DEFAULT_EXPECTED_MINUTES = 15`

T-17 で hardcode。`docs/billing-ui-flow.md §10.1` に「通話履歴平均で置き換える」記載あり。Sprint 4 で履歴分析ロジック実装時に置き換え。

### 2.10 `zh-ja` quality-qa fixture 不足

T-61 で 13 言語ペア × 5 シナリオ = 65 fixture を作成したが、`zh-ja` (中国語→日本語) が `en-ja` に置き換わっている。Phase 1a 完成前に `zh-ja/` ディレクトリを追加。

### 2.11 `termsVersion` / `privacyVersion` hardcode (T-9)

`packages/transcript/src/facade.ts` 内で `"1.0.0"` hardcode 中。`docs/legal-and-consent.md §5.3` canonical は `2026-05-12` 形式。Sprint 4 で `AuthFacade.getRequiredConsents()` 経由で DB から取得するよう書き換え。

### 2.12 T-23 退会フロー サーバー側 grace period 実装

T-23 mobile UI は実装済 (commit `9c75b63`) だが、`POST /api/account/delete` のサーバー実装は即時削除の可能性。Sprint 4 で:
- 30 日 soft delete (`profiles.deleted_at` セット)
- 30 日後の物理削除バッチ (T-60 retention に組み込み済 or 別バッチ)
- 30 日内の復元 endpoint

### 2.13 Android Manifest plugin — FCM サービスクラス名不一致 (Sprint 3 後半 D Round 2 で発見)

`apps/mobile/plugins/with-android-manifest.ts` は `.TranCallFirebaseMessagingService` を AndroidManifest に宣言するが、実装済みの Kotlin クラスは `tech.hori.trancall.FcmService` (class 名 `FcmService`)。Expo prebuild 後の AndroidManifest.xml には存在しないクラス名が登録されるため、FCM data message が `onMessageReceived` に到達せず着信通話が動作しない。

**対処**: plugin の FCM service 宣言名を `.FcmService` に修正するか、`FcmService.kt` のクラス名を `TranCallFirebaseMessagingService` に改名する。ConnectionService.kt 実装時（Sprint 3 Phase 1a）に合わせて解決する。

### 2.14 Android Manifest plugin — ConnectionService クラス名の設計書との差異

設計書 (`native-call-bridge.md §5.1`) は `.CallConnectionService` と宣言しているが、plugin は `.TranCallConnectionService` を宣言。ConnectionService.kt は未実装（Sprint 3 Phase 1a 予定）のため現時点では機能影響なし。実装時にどちらのクラス名を採用するか確定し、plugin または設計書を合わせる必要がある。

### 2.15 app.json に `android.permission.FOREGROUND_SERVICE` が未宣言

`CallForegroundService.startForeground()` を呼ぶには Android 9 (API 28) 以上で `android.permission.FOREGROUND_SERVICE` の `<uses-permission>` 宣言が必要（normal permission、manifest 宣言のみで付与）。現在 app.json の `android.permissions` に含まれておらず、`CallForegroundService.kt` 実装後に `SecurityException` で異常終了する。

**対処**: Sprint 3 Phase 1a で `CallForegroundService.kt` を実装する際に `app.json` の `android.permissions` に `"android.permission.FOREGROUND_SERVICE"` を追加する。

### 2.16 `com.google.android.c2dm.permission.RECEIVE` の要否

設計書 §5.1 に記載されているが、現代の Firebase Messaging SDK (v21+) はこの permission を SDK 内部で自動宣言するため、アプリ側の明示宣言は不要。`app.json` への追加は不要。Sprint 4 での設計書更新時に §5.1 の記述を削除推奨。

### 2.17 iOS Simulator build — pnpm + CocoaPods autolinking 課題

`npx expo prebuild --platform ios` で `ios/` を生成後、`pod install` を実行すると `react-native` の podspec autolink が失敗:

```
[!] list_native_modules! skipped the react-native dependency 'react-native'. No podspec file was found.
```

**原因**: pnpm の symlink 構造 (`apps/mobile/node_modules/react-native -> ../../../node_modules/.pnpm/react-native@.../node_modules/react-native`) を `@react-native-community/cli` autolinking が resolve できない。

**対処**:
1. `.npmrc` に `node-linker=hoisted` または `public-hoist-pattern[]=react-native*` を追加 + clean `pnpm install`
2. または apps/mobile に `react-native` を直接 dependency に展開 (workspace 外で flat install)

**現状**: Sprint 3 native files (HmacValidator.swift / PushKitDelegate.swift / PrivacyInfo.xcprivacy / TranCall.entitlements) は復元済。Sprint 4 で `.npmrc` 設定と `pnpm install --shamefully-hoist` 等の対処を行ってから `expo run:ios` 実行を推奨。

### 2.18 iOS native files の Expo Config Plugin 化

`npx expo prebuild` は `ios/` ディレクトリを clearing して再生成するため、Sprint 3 で手動配置した以下 4 ファイルが消失する:
- `apps/mobile/ios/CallBridge/HmacValidator.swift`
- `apps/mobile/ios/CallBridge/PushKitDelegate.swift`
- `apps/mobile/ios/TranCall/PrivacyInfo.xcprivacy` (T-48)
- `apps/mobile/ios/TranCall/TranCall.entitlements` (T-50)

**対処**: Sprint 4 で `apps/mobile/plugins/with-ios-callbridge.js` 等の Expo Config Plugin を作成し、prebuild フックで上記 4 ファイルを programmatic に配置する。

### 2.19 Expo Config Plugin TS → JS 変換

`apps/mobile/plugins/with-android-manifest.ts` は EAS Build (`eas build --local`) で「plugin 解決失敗」になる。`.ts` から `.js` (CommonJS) に変換した `with-android-manifest.js` を併存させて回避済 (commit pending)。

**対処**: Sprint 4 で TypeScript ベースの plugin を完全削除し、JavaScript plugin のみを canonical とする。または、tsx/jiti ベースの plugin loader 設定を `package.json` に追加。

## 3. T-29 履歴

- **v1.3** (`production-runbook.md`): serverless-http 撤去 → `app.server.emit` パターン canonical 化
- **v1.4.0** (`module-contracts.md`): `exportTranscript` 戻り型に `filename` 追加、その他 Sprint 3 拡張 (AuthFacade 4 メソッド / BillingFacade 7 メソッド / ConsentRepository / ExternalPurchaseTokenRepository) を反映済

## 4. 関連 PR / Commit

Sprint 3 Week 1-2 で main に統合された commits:
- T-1: `693cf01` Vercel serverless 化
- T-2: `4e196b6` consent migrations + GDPR anonymize TODO
- T-3: `bfabf12` external_purchase_tokens migration
- T-4: `6c62126` Consent Zod
- T-5: `9563d1e` Billing View Model Zod
- T-6: `b6358e2` AuthFacade 拡張
- T-7: `8c62316` BillingFacade 拡張
- T-8: `dfc7f20` notification HMAC 署名
- T-9: `dea6a3a` transcript export PDF/TXT
- T-10: `bd89cf1` server endpoints 13 種
- T-11: `5f8ebcd` PERMISSION_* error code
- T-12: `4b4dd80` DI container wire-up
- T-13: `11d495c` translation-agent パイプライン
- T-14: `30e0b41` degraded/recovered Data Channel
- T-15〜T-26: mobile 12 件 (commits 4e827d5 / 2d60f04 / 2b17f91 / b7d8c47 / 5ab20de / 9c75b63 / 0f8ad4c / 17625bd / 9727a8d / e8999e0 / 0e253c5 / 38380c0)
- T-31: `0ce422c` gate-check スクリプト
- T-38: `10abff2` Maestro E2E + mock-server
- T-60: `2e828f6` Supabase retention Edge Function
- T-61: `5d6e2e0` quality-qa cron

main HEAD: `668d900` (T-29 sync 後は新規 commit)
