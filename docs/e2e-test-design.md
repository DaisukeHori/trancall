# TranCall E2E テスト設計書

| | |
|---|---|
| Status | Draft v1.3 (2026-05-12) |
| Owner | Mobile (Layer 4) + QA |
| 上位文書 | `docs/test-strategy.md` (テストピラミッド本体) |
| 補助 | `docs/requirements.md` (PERF/AVAIL 数値目標), `docs/module-contracts.md` (facade 契約), `apps/mobile/CLAUDE.md` (screens 一覧) |
| 改訂条件 | 採用ツール変更時 / シナリオ追加時 / Phase 移行時 |

本書作成時点 (PR #27) では `test-strategy.md` に「E2E は Detox or Maestro、Phase 1b 以降」とだけ記されていた。本書はその空欄を **Maestro 採用前提で確定** し、シナリオ・モック戦略・CI 統合・Phase 分担を canonical 化する (同 PR で `test-strategy.md` も「Maestro」確定に更新済み)。

---

## 1. 採用ツールの確定

### 1.1 結論: **Maestro** (mobile.dev)

| 評価軸 | Maestro | Detox |
|---|---|---|
| Expo SDK 54 + RN 0.81 newArch opt-out | YAML だけで動作、prebuild への侵入なし | `detox.config.js` + native ビルド変更が必要 |
| `accessibilityLabel` セレクタ | `text:` / `id:` で直接 hit、`t(...)` で生成したラベルがそのまま使える | accessibility に対応するがブリッジ層が独自 |
| CI 実行 | GitHub Actions macos-14 + iOS Simulator / ubuntu-latest + Android Emulator | 同等可、ただし設定量が多い |
| Flaky 度 (RN 0.81) | プロジェクト評価で許容範囲 (要計測) | スワイプ系で flaky 報告複数 |
| 学習コスト | YAML + 簡易 JS、初学者にやさしい | TypeScript、API 多い |

棄却理由 (Detox): native build pipeline への変更が Expo prebuild と衝突する可能性が高く、Phase 1 のスピード優先と矛盾する。

### 1.2 採用しないツール
- **Appium**: 抽象度が低く、シナリオ作成コストが Maestro の 3-5 倍。
- **Playwright Mobile / WebDriverIO**: WebView 中心、ネイティブ画面比率が高い TranCall に不適合。
- **Mobile-friendly Cypress**: RN ネイティブをサポートしない。

### 1.3 補助ツール
- **Mock Service Worker (msw) for Node**: API モックを Vitest と E2E で共有する Phase 1c で検討 (Phase 1b では HTTP プロキシで代替)。
- **LiveKit Egress 不要**: E2E は実 LiveKit 経由ではなく Mock peer / DataChannel 直注入で実施。

---

## 2. テストピラミッドにおける位置付け

```
        ┌────────────────────────┐
        │ E2E (Maestro)          │  ← 本書のスコープ
        │ - Critical user        │     Phase 1b 以降
        │   journeys / 端末1台 │
        ├────────────────────────┤
        │ API handler (Fastify   │
        │ inject) 11 ファイル   │     既存 (apps/server)
        ├────────────────────────┤
        │ Integration (Vitest    │
        │ + in-memory mock) 15  │     既存 (packages/integration-tests)
        ├────────────────────────┤
        │ Unit (Vitest) 150+    │     既存 (各 packages)
        └────────────────────────┘
```

E2E は **下位 3 層でカバー不能な統合パスのみ** を対象とする (Provider 階層、navigation、a11y、視覚レイアウト、permission gates、画面間 store 共有)。下位層で十分検証できる Zod schema / Result 分岐 / Repository CRUD などは E2E に含めない。

なお `docs/test-strategy.md` のピラミッドは「ユニット / 統合 / E2E」の 3 層で描画している。本書の 4 層は「統合」を `Integration (Vitest in-memory mock)` と `API handler (Fastify inject)` に細分化したもの (両方とも `test-strategy.md` の "統合" に含まれる)。論理矛盾はなく粒度差のみ。

---

## 3. スコープと非スコープ

### 3.1 E2E が **検証する** こと
- 12 screens (SCR-001〜SCR-012、Login/SignUp/placeholder tab を除く) のレンダリング・要素存在・accessibilityLabel 一致 — SCR-010 (Calling) は `SCR-009_precall_to_call.yaml` 内で通過確認
- 主要 user journey の遷移 (Onboarding→Home, Contacts→AddContact→ContactProfile→PreCall→Calling→InCall→CallSummary→FullTranscript)
- 4 permission/consent gates のフロー (mic / notification / caller / callee)
- light / dark theme 両方でのレンダリング (通話画面が dark 固定の検証含む)
- ja / en / zh 切り替え時の文言とレイアウト崩れ
- スワイプ削除 (SCR-005) / Switch / Pressable の操作確実性
- 翻訳 ON/OFF バッジ + 語ペア + 残量 の常時表示 (SCR-003 / SCR-009 / SCR-011)
- 課金不足時の `BILLING_INSUFFICIENT_BALANCE` UI 遷移

### 3.2 E2E が **検証しない** こと (他層 / 非自動)
- LiveKit RT 接続品質 → Phase 1c 負荷試験 (k6 + 実機手動)
- OpenAI Realtime 翻訳精度・遅延 → 別ベンチマーク
- CallKit のロック画面着信 → 実機手動テスト (シミュレータ不可)
- APNs VoIP Push 実配信 → ステージング環境での手動 + sandbox
- Stripe / IAP 決済 → sandbox 半手動、本番直前にスモーク
- RLS (Row Level Security) → pgTAP / Supabase local
- 通話の **両端末同時** 実態 → 1 端末 + Mock peer で代替
- WCAG 2.1 AA コントラスト比の自動検証 → 専用ツール (axe-core 等) で別途、または手動チェック
- CONTACT-002 (QR コード追加) → 実装が Sprint 2/Phase 2 のため当面手動
- ROOM-009/010 (通話履歴一覧 / 履歴から再発信) → `GET /api/rooms/history` が Sprint 2 実装のため未対応

---

## 4. モック戦略 (重要)

E2E ビルドは **専用バリアント (`expo-env: e2e`)** を作る。差分は env だけで、ソースコードは production と共通。

### 4.1 環境変数で差し替える境界

| 境界 | 本番 | E2E |
|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | `https://api.trancall.app` | `http://localhost:4010` (Mock Server) |
| `EXPO_PUBLIC_SUPABASE_URL` | 本番 Supabase | local Supabase (`supabase start`) |
| LiveKit token endpoint | `apps/server` 経由 | Mock peer ID + 固定 token を返す Mock Server |
| OpenAI WS | `wss://api.openai.com/...` | 接続せず、字幕は DataChannel 直注入で代替 |
| APNs VoIP Push | 実 push | `/api/__e2e__/trigger-incoming-call` の REST endpoint で代替 |

### 4.2 Mock Server の構成

`apps/mock-server/` を新規作成 (Phase 1b 着手と同時)。Fastify ベースで以下を提供:

- `/api/auth/*` — Supabase Auth と互換のフェイク (ローカル fixture)
- `/api/contacts/*` — `apps/server` と同じ shape、データは in-memory
- `/api/rooms/*` — createCall は固定 roomId、`/leave` は no-op
- `/api/transcripts/:roomId` — fixture transcript JSON を返す
- `/api/billing/*` — 残量・プラン固定値
- `/api/__e2e__/trigger-incoming-call` — テスト操作用フック (incoming-call deep link を Maestro が叩く)
- `/api/__e2e__/inject-subtitle-delta` — テスト操作用フック (DataChannel injection を模擬)

Mock Server は **production ビルドには含めない**。具体的 gating 手段は Phase 1b Day 1 に確定する (候補: `apps/mock-server/package.json` を `private: true` + EAS build profile (`eas.json`) の include/exclude で除外、Turborepo の filter で `--filter=!@trancall/mock-server` を production task に適用)。本書 §11 未解決事項参照。

### 4.3 ネイティブモジュールのスタブ

`react-native-callkeep` / `react-native-voip-push-notification` / LiveKit RN SDK は E2E ビルドで **DI 差し替え**:

```ts
// apps/mobile/src/lib/callkit/index.ts (既存設計)
let _nativeModuleOverride: RNCallKeepNativeModule | null = null;
export function setCallKeepNativeModule(mod: RNCallKeepNativeModule | null): void {
  _nativeModuleOverride = mod;
}

// apps/mobile/src/lib/callkit/e2e-stub.ts (新規)
export const e2eCallKeepStub: RNCallKeepNativeModule = {
  setup: (_config: unknown) => {},
  displayIncomingCall: (..._args: unknown[]) => {},
  answerIncomingCall: (_uuid: string) => {},
  endCall: (..._args: unknown[]) => {},
};
```

App.tsx (e2e ビルド) で起動時に `setCallKeepNativeModule(e2eCallKeepStub)` を実行。本番ビルドは何もしない (real module が登録される)。

LiveKit の `RoomHandle` は既に `duck-typed` (`apps/mobile/src/lib/livekit/connect.ts`)。E2E では `connectToRoom` を Mock 実装に置換し、DataChannel handler を直接 invoke できるテストフック (`__e2e_pushSubtitleDelta`) を expose する。

### 4.4 Caller/Callee 両端末問題

1 端末 E2E では片側のみ実機 (Maestro 制御)。相手側は **Mock peer**:

- Pre-call → Calling: 自端末から発信、Mock Server が "callee 応答" を 1.5s 後に返す (固定タイマー)
- In-call: Mock Server が DataChannel injection 経由で字幕 delta を流す
- Incoming call の検証は別シナリオで `trigger-incoming-call` 経由

両端末リアル E2E (実際に 2 デバイスペアリング) は **Phase 1c 手動テスト** に分離 (Maestro Cloud Sequence でも可能だが Phase 1b はスコープ外)。

---

## 5. シナリオ一覧 (P0=14 / P1=7 / P2=4 = 25 flows)

ディレクトリ: `apps/mobile/e2e/maestro/flows/`
命名: `SCR-XXX_*.yaml` (画面 ID prefix)

### 5.1 P0 — Critical (Phase 1b 必須、基本 10 + gates 4 = 14)

| Flow | 内容 | 検証セレクタ例 |
|---|---|---|
| `00_smoke_app_launch.yaml` | アプリ起動 → Home まで | `text: "TranCall"`, `id: home-recent-list` |
| `SCR-001_onboarding.yaml` | 言語選択 → consent → tutorial 3 step → Home | `t("common.next")`, `t("onboarding.poweredBy")` |
| `auth_signin.yaml` | login → Home | `t("auth.signIn")`, `t("auth.email")` |
| `auth_signup.yaml` | signup → consent gate → onboarding → Home | `t("auth.consent.checkboxLabel")` |
| `SCR-005_contacts_browse.yaml` | favorites / all 表示、検索、スワイプ削除 | `t("contacts.swipeDelete")` |
| `SCR-007_add_contact.yaml` | trancallId 検索 → 追加 | `t("addContact.search.addButton")` |
| `SCR-009_precall_to_call.yaml` | Pre-call → 翻訳 ON → 発信 → Calling → InCall (mock応答) | `t("call.startCall")`, `t("translation.enabled")` |
| `SCR-003_incall_controls.yaml` | mute, speaker, translation toggle, 字幕表示, 終話 | `t("call.mute")`, `t("call.endCall")` |
| `SCR-004_incoming_call.yaml` | `trigger-incoming-call` → 着信画面 → 応答 → InCall | `t("call.incomingCall")`, `t("call.accept")` |
| `SCR-011_summary_and_transcript.yaml` | 終話後 Summary → FullTranscript → export | `t("callSummary.viewTranscript")`, `t("transcript.exportPdf")` |
| `gate_mic_permission.yaml` | 初回発信時の Mic permission gate | `t("permissions.microphoneTitle")` |
| `gate_notification_permission.yaml` | 初回起動時の Notification permission gate | `t("permissions.notificationTitle")` |
| `gate_consent_caller.yaml` | 翻訳同意 (caller side) | `t("consent.agree")` |
| `gate_consent_callee.yaml` | 翻訳同意 (callee side) | `t("consent.agree")` |

### 5.2 P1 — Important (Phase 1c 推奨)

| Flow | 内容 |
|---|---|
| `theme_light_dark.yaml` | system theme 切り替え、通話画面が dark 固定であることの確認 |
| `i18n_ja_en_zh.yaml` | 言語切り替えでレイアウト崩れなし、3 言語で同じシナリオ |
| `billing_low_balance.yaml` | 残量 0 → `BILLING_INSUFFICIENT_BALANCE` → アップグレード CTA |
| `translation_reconnect.yaml` | DataChannel 切断 → reconnecting バッジ → recovered cross-fade |
| `SCR-008_contact_profile.yaml` | 通話/メッセージ/編集 3 ボタン、block/report/remove フロー |
| `SCR-006_settings.yaml` | nativeLanguage 変更、signOut、deleteAccount 二段確認 |
| `SCR-012_transcript_search.yaml` | キーワード検索、original/translation フィルタ、access revoke |

### 5.3 P2 — Edge cases (Phase 1c 以降、漏れたら手動)

| Flow | 内容 |
|---|---|
| `flaky_network_during_call.yaml` | airplane mode toggle で reconnecting |
| `background_foreground.yaml` | 通話中 background → foreground 復帰 |
| `incoming_during_call.yaml` | 通話中の着信 (call waiting) — Phase 2 機能、暫定 skip |
| `permission_denied_path.yaml` | mic denied 時の代替 UI |

### 5.4 シナリオ雛形 (Maestro YAML)

本サンプルは **Phase 1b Day 1 の i18n 環境変数置換実装後** の最終形 (`${T_*}` プレースホルダで i18n キーを Maestro 起動時に解決した値に展開する想定)。`${T_call_startCall}` 等は `apps/mobile/e2e/maestro/scripts/inject-i18n-env.ts` (Phase 1b Day 1) が `packages/ui-kit/src/i18n/locales/{ja,en,zh}.json` を読んで生成する。コメントは規約により書かない。

```yaml
appId: app.trancall.dev
name: "SCR-009 — Pre-call → InCall (translation ON)"
tags: [P0, call]
---
- runFlow: shared/login_as_e2e_user.yaml
- tapOn:
    id: "contact-row-${E2E_PEER_TRANCALL_ID}"
- tapOn:
    text: ${T_contactProfile_call}
- assertVisible:
    text: ${T_precall_title}
- assertVisible:
    text: ${T_translation_enabled}
- assertVisible:
    text: ${T_precall_remainingMinutes}
- tapOn:
    id: "translation-toggle"
- tapOn:
    accessibilityLabel: ${T_call_startCall}
- assertVisible:
    text: ${T_call_calling}
- waitForAnimationToEnd:
    timeout: 2000
- assertVisible:
    text: ${T_call_inCall}
- assertVisible:
    accessibilityLabel: ${T_call_endCall}
```

---

## 6. ディレクトリ構造 (確定案)

```
apps/mobile/
├── e2e/
│   ├── maestro/
│   │   ├── flows/
│   │   │   ├── 00_smoke_app_launch.yaml
│   │   │   ├── SCR-001_onboarding.yaml
│   │   │   ├── SCR-003_incall_controls.yaml
│   │   │   ├── ...
│   │   │   └── shared/
│   │   │       ├── login_as_e2e_user.yaml
│   │   │       ├── reset_mock_server.yaml
│   │   │       └── grant_permissions_ios.yaml
│   │   ├── config.yaml            # Maestro project config
│   │   └── fixtures/
│   │       ├── contacts.json
│   │       ├── transcript-sample.json
│   │       └── billing-state.json
│   ├── README.md                  # ローカル実行手順
│   └── e2e-build-config.json      # eas build profile reference
apps/mock-server/                  # 新規 (Phase 1b Day 1)
├── src/index.ts
├── src/routes/
└── package.json
```

---

## 7. CI 統合

### 7.1 GitHub Actions 構成 (Phase 1b 追加)

`.github/workflows/e2e.yml` を新設 (CI 本流 `ci.yml` は触らない):

```yaml
name: E2E (Maestro)

on:
  workflow_dispatch:
  pull_request:
    paths:
      - "apps/mobile/**"
      - "apps/mock-server/**"
      - "packages/ui-kit/**"
      - ".github/workflows/e2e.yml"

jobs:
  android:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @trancall/mock-server build && pnpm --filter @trancall/mock-server start &
      - uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 33
          target: google_apis
          script: |
            curl -Ls "https://get.maestro.mobile.dev" | bash
            export PATH=$PATH:$HOME/.maestro/bin
            cd apps/mobile && eas build --local --profile e2e --platform android
            maestro test apps/mobile/e2e/maestro/flows/ --include-tags P0

  ios:
    runs-on: macos-14
    timeout-minutes: 45
    # 同様、xcrun simctl + maestro test
```

Pull Request に対しては **P0 タグのみ** を走らせ、main マージ後 nightly で P0+P1+P2 全実行。

### 7.2 マージブロッキング方針
- P0 全 PASS = ブロッキング (PR マージ条件)
- P1 失敗 = warning (PR コメント、ブロックしない)
- P2 失敗 = nightly のみ追跡 (Slack 通知)

---

## 8. Phase 分担

| Phase | 期間目安 | 内容 |
|---|---|---|
| **1a (現在)** | Sprint 1 残 | E2E 未着手で OK。本書を canonical 化、Sprint 1 完了基準には含めない |
| **1b (Sprint 2)** | 2-3 週 | mock-server 構築、Maestro CLI 導入、P0 14 flows 実装、CI workflow 追加、Android emulator で nightly 稼働 |
| **1c (Sprint 3)** | 2 週 | P1 7 flows 追加、iOS Simulator 対応 (macos-14 runner)、両端末リアル E2E は **手動チェックリスト**で運用、theme/i18n マトリクス |
| **2.0 (post-MVP)** | — | P2 + Maestro Cloud (有料) で 並列実機テスト、両端末リアル E2E 自動化検討 |

Phase 1a で **本書作成のみ**、コードは 0 行追加。Sprint 1 のスケジュール影響なし。

---

## 9. テストデータと環境

### 9.1 fixture users
- `e2e_user_a@trancall.dev` (ja, Free plan, balance 100 min)
- `e2e_user_b@trancall.dev` (en, Standard plan, peer)
- `e2e_user_c@trancall.dev` (zh, balance 0、課金エラー検証用)

### 9.2 fixture contacts
`apps/mobile/e2e/maestro/fixtures/contacts.json` に最低 5 件、うち 1 件 favorite、1 件 blocked。

### 9.3 fixture transcripts
`fixtures/transcript-sample.json` で 30 segment、final/partial 混在、search 結果用に "hello" を 3 箇所配置。

---

## 10. 規約遵守チェック (E2E 固有)

- セレクタは i18n キー名と一致 (`text:` ではなく i18n 解決後の文字列を渡すための環境変数置換を必ず通す)
- ハードコード待機 (`waitForAnimationToEnd` のタイムアウト固定) は **2000ms 上限**、それを超える場合 `assertVisible` のリトライへ
- スクリーンショット差分テストは **採用しない** (Phase 1c で要再検討)。理由: a11y + tree-based の方が flaky 化しにくい
- Maestro flow YAML には **コメントを書かない** (CLAUDE.md の "コメント禁止" 方針を踏襲、tags と name で意図を示す)

---

## 11. 既知の未解決事項

1. **DataChannel 直注入の API 設計**: `apps/mobile/src/lib/livekit/` がまだ未実装 (Layer 4-C で initial 実装中)。Phase 1b 開始時に `__e2e_pushSubtitleDelta` 注入口を確定する必要あり。
2. **Maestro 実機 flaky 計測**: 採用判断は Sprint 2 Day 3 までに smoke 5 flow を回し、retry なしで 95%+ green が出るか確認。落ちる場合は Detox を再評価。
3. **eas build E2E profile**: `eas.json` の `e2e` profile (環境変数、native module 差し替え) は Layer 4 完了後に作成。Phase 1a では雛形のみ docs に残す。
4. **mock-server の TS 共有**: `apps/server` と shape を完全同期する仕組み。当面手動同期、Phase 1c で共通 schema パッケージ化を検討。
5. **`docs/test-strategy.md` との整合**: 本 PR (Sprint 1 v12) で「Detox or Maestro」→「Maestro」更新済み。

---

## 12. 改訂履歴

- v1 (2026-05-12) 初版。Sprint 1 中に Layer 4 が一段落した時点で E2E 戦略を確定するために作成。
- v1.1 (2026-05-12) PR #27 Round 1 レビュー反映 (commit `1db39c6`): §5 ヘッダー flows 数訂正、CallKeepNativeModule→RNCallKeepNativeModule、YAML サンプルの `${T_*}` プレースホルダ化と timeout 2000ms 統一、4 gates 完備、SCR-010 帰属注記、mock-server gating 候補追記、test-strategy 注記。
- v1.2 (2026-05-12) PR #27 Round 2 レビュー反映: P0 12→14 flows の波及更新、e2eCallKeepStub に answerIncomingCall 追加、§1 冒頭の test-strategy 参照を過去形に。
- v1.3 (2026-05-12) PR #27 Round 3 レビュー反映: ヘッダー Status を v1.3 に更新 (v1.1 / v1.2 で更新漏れのまま `Draft v1` が残存していたため一括是正)、§5.1 P0 内訳式を「基本 10 + gates 4 = 14」に修正 (実テーブルと一致)。
