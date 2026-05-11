# CLAUDE.md — apps/mobile

## 概要
React Native + Expo SDK 54 による iOS/Android アプリ。Phase 1 のメインクライアント。
Legacy Architecture opt-out 可能な最後の SDK (RN 0.81 / React 19.1)。

## 主要画面 (12 screens + 4 permission/consent gates)
- `SCR-001` Onboarding
- `SCR-002` Home / Recent calls
- `SCR-003` In-call
- `SCR-004` Incoming call
- `SCR-005` Contacts
- `SCR-006` Settings
- `SCR-007` Add contact
- `SCR-008` Contact profile
- `SCR-009` Pre-call setup
- `SCR-010` Calling / Ringing
- `SCR-011` Call summary
- `SCR-012` Full transcript
- Mic permission / Notification permission / Caller consent / Callee consent

## 依存するパッケージ
- `@trancall/ui-kit` — **画面実装は必ずこれ経由** (直接スタイル禁止)
- `@trancall/shared-kernel` — Branded Type / Result / DomainEvent
- `@trancall/auth` `@trancall/room` `@trancall/contact` `@trancall/transcript` `@trancall/billing` — facade interface のみ参照
- LiveKit React Native SDK
- `react-native-callkeep` (CallKit / ConnectionService)
- `react-native-voip-push-notification`
- `i18next` + `react-i18next` + `expo-localization`

## UI 実装ルール (Layer 4 で厳守)

### 1. canonical 参照
- **`docs/design/design-system.md`** — 全画面の UI 仕様の主要参照
- **`apps/mobile/_design-ref/`** — react-babel jsx mockup (RN 移植元素材)
  - `screens/Onboarding.jsx` `Login.jsx` `Home.jsx` `Contacts.jsx` `Incoming.jsx` `InCall.jsx` `Settings.jsx`
  - `components/CallRow.jsx` `Modals.jsx` `Primitives.jsx` `SubtitleOverlay.jsx` `Tokens.jsx` `ios-frame.jsx`
  - **`_` prefix の意味**: 配置物は実装の参照素材 (Web preview)、本実装ではない
- **`docs/design/preview/*.html`** — 各コンポーネントの視覚プレビュー (実装時の見た目確認用)

### 2. スタイル
- 直接 `StyleSheet.create({ color: "#0A7AFF" })` のようなハードコード禁止
- 必ず `@trancall/ui-kit` の tokens を参照: `import { colors, spacing, typography, radii } from "@trancall/ui-kit"`
- light / dark テーマ対応必須 (`useColorScheme()` で切り替え)

### 3. コンポーネント
- 既存の `@trancall/ui-kit` コンポーネントを最大限活用
- 画面固有の compound component が必要な場合のみ `apps/mobile/src/components/` に作成 (汎用化できれば ui-kit に昇格)

### 4. i18n
- 全文言は `@trancall/ui-kit/src/i18n/locales/{ja,en,zh}.json` から取得
- 画面内文字列直書き禁止 (例外: 数値 / 識別子のみ)

### 5. ブランドアセット
- アプリアイコン / ワードマーク: `packages/ui-kit/assets/trancall-icon.svg` / `trancall-mark.svg`
- iOS Asset Catalog / Android `res/mipmap-*` への変換は Expo CLI で対応

### 6. プラットフォーム配慮
- portrait 固定 (375×812 → 412×915)
- Safe Area + キーボード回避必須
- タップ領域 44×44 以上 (iOS HIG)
- CallButton 56×56 / 通常コントロール 48×48

### 7. アクセシビリティ
- 全 `TouchableOpacity` / `Pressable` に `accessibilityLabel` + `accessibilityRole`
- 翻訳状態は screen reader にも常時アナウンス
- WCAG 2.1 AA (コントラスト 4.5:1 以上)

### 8. 状態管理
- API 呼び出し: TanStack Query (Server state)
- Local state: Zustand (call lifecycle / UI state)
- API client: `apps/server` の REST endpoint を `fetch` + Zod safeParse でラップ

### 9. 通話関連
- 翻訳 ON/OFF バッジを **必ず常時表示** (in-call / pre-call / summary 全画面)
- 語ペア (`JA → EN`) ステータス表示
- 課金残量表示 (`残り N 分（{plan}）`)
- ambient passthrough (原音 30% 重畳) を実装、ただし UI には surface しない

## 禁止事項
- 直接スタイル書き (tokens 必須)
- 文言直書き (i18n 必須)
- Claude / Anthropic / OpenAI ロゴ表示 (consent 画面で "OpenAI" テキスト言及のみ可)
- 装飾 emoji
- 派手なアニメ (許可は `design-system.md` に明記された 3 種のみ)
- 翻訳状態のあいまい表示
