# CLAUDE.md — TranCall

## プロジェクト概要

TranCallはGPT-Realtime-Translateを活用したリアルタイム翻訳付きVoIP通話アプリ。
モジュラーモノリスアーキテクチャ（10モジュール + 4アプリ）で構築し、Zodスキーマで全モジュール境界を定義する。

## リポジトリ構造

```
trancall/
├── docs/                          # プロジェクトドキュメント
│   ├── requirements.md            # 要件定義書
│   ├── architecture.md            # アーキテクチャ設計書
│   ├── module-contracts.md        # モジュール間 facade/event/repository 契約 (canonical)
│   └── design/                    # TranCall Design System (canonical UI 仕様)
│       ├── design-system.md       # ★ 全画面の UI 仕様 (colors/typography/spacing/a11y) 主要参照
│       ├── colors_and_type.css    # CSS custom properties (web mirror)
│       ├── SKILL.md               # Claude Design Skill manifest
│       ├── preview/*.html         # トークン/コンポーネント視覚プレビュー (20 件)
│       └── tokens.md / wireframes/ / screens/ / components/ など
├── packages/                      # モジュラーモノリスの各モジュール
│   ├── shared-kernel/             # Event Bus, DI, 共通型
│   ├── auth/                      # 認証・ユーザー管理
│   ├── room/                      # 通話セッション管理
│   ├── signaling/                 # LiveKit接続制御
│   ├── media/                     # 音声トラック抽象化 + Transport Adapter
│   ├── translation/               # GPT-RT-Translate接続
│   ├── billing/                   # 課金 (Stripe + IAP)
│   ├── contact/                   # 連絡先管理
│   ├── notification/              # Push通知 (APNs + FCM)
│   ├── transcript/                # 字幕・文字起こし・エクスポート
│   └── ui-kit/                    # 共通UIコンポーネント
├── apps/
│   ├── mobile/                    # React Native + Expo (iOS/Android)
│   ├── desktop/                   # Electron (macOS/Windows) — Phase 3
│   ├── server/                    # APIサーバー (Node.js)
│   └── translation-agent/         # LiveKit Agent (翻訳ワーカー)
├── CLAUDE.md                      # このファイル
├── package.json
└── turbo.json
```

## 開発ルール（厳守）

### 型安全性

- `as any`, `as unknown`, `@ts-ignore`, `@ts-expect-error` は禁止
- 型アサーション (`as SomeType`) は原則禁止 — ESLint `assertionStyle: "never"`
- 例外: `adapters/*` と `schemas/brand.ts` 内の境界変換ヘルパーのみ許可
  - `fromLiveKitTrackSid()`, `parseOpenAIEvent()`, `toPcm24Frame()`, `brandUuid()`, `parseEnv()` 等
  - 通常のドメインコードでは型アサーション禁止を維持
- 外部入力は必ず Zod `safeParse()` でバリデーション
- 例外throwの代わりにResult型 (`{ ok: true, data } | { ok: false, error }`) を使用
- TSConfig: `strict: true`, `noUncheckedIndexedAccess: true`

### モジュール境界

- モジュール間の通信はFacadeインターフェース経由のみ
- 各モジュールの `package.json` の `exports` で公開APIを制限
- 内部実装への直接importは禁止
- ドメインイベント（EventBus）による非同期連携を推奨

### コーディング規約

- 言語: TypeScript (strict mode)
- パッケージスコープ: `@trancall/*`
- Zodスキーマは `schemas.ts` にまとめ、型は `z.infer<>` で導出
- Branded Types (`z.string().uuid().brand<"UserId">()`) でプリミティブを区別
- ファイル命名: kebab-case (`translation-service.ts`)
- テスト: vitest, 各モジュール内の `__tests__/` ディレクトリ

### コミット

- Git email: `nvidia.homeftp.net@gmail.com`
- コミットメッセージ: Conventional Commits (feat/fix/refactor/docs/chore)
- 例: `feat(translation): add GPT-RT-Translate WebSocket connection`

### UI / デザインシステム (Layer 4 mobile 着手時に厳守)

- **唯一の canonical UI 仕様**: `docs/design/design-system.md`
  - colors / typography / spacing / radii / elevation / animation / a11y / 状態 / 文言ガイド (ja/en) を完全規定
  - 旧 `docs/design/tokens.md` 等は補助参照、矛盾時は `design-system.md` を正とする
- **共通コンポーネント**: `@trancall/ui-kit` を必ず経由 (`Button` / `Input` / `Card` / `ContactRow` / `CallCard` / `SubtitleOverlay` / `LanguagePicker` / `PlanCard` 等)
  - 画面内で直接スタイルを書かず、tokens (`@trancall/ui-kit` の `colors` / `spacing` / `typography` / `radii`) のみ参照
- **ブランドアセット**: `packages/ui-kit/assets/trancall-icon.svg` / `trancall-mark.svg`
- **画面実装の素材**: `apps/mobile/_design-ref/` (react-babel 用の jsx mockup)
  - 7 screens (Onboarding / Login / Home / Contacts / Incoming / InCall / Settings) + 共通コンポーネント
  - **`_` prefix の意味**: 配置物は実装の参照素材であり、本実装ファイルではない (RN への移植時に StyleSheet/Pressable に書き換え)
- **i18n**: `@trancall/ui-kit/src/i18n/locales/{ja,en,zh}.json` を canonical、画面内に直書きしない (文言は ja/en/zh 全て翻訳)
- **禁止**: Claude / Anthropic / OpenAI のロゴ表示 (consent 画面でテキストとして "OpenAI" 言及のみ可)、装飾 emoji、派手なアニメ、独自 color palette
- **必須**: 翻訳 ON/OFF バッジ、語ペア (`JA → EN`) ステータス表示、課金残量表示

## 技術スタック

- Runtime: Node.js 22+
- Package Manager: pnpm
- Monorepo: Turborepo
- Mobile: React Native + Expo SDK 54+（Legacy Architecture opt-out 可能な最後のSDK。React Native 0.81 / React 19.1）
- Desktop: Electron (Phase 3)
- SFU: LiveKit
- 翻訳: OpenAI GPT-Realtime-Translate
- DB: Supabase (PostgreSQL)
- 認証: Supabase Auth
- 課金: Stripe + IAP
- Push: APNs VoIP Push + FCM
- i18n: i18next + react-i18next + expo-localization
- バリデーション: Zod v4
- テスト: Vitest
- CI/CD: GitHub Actions

## 各モジュールのCLAUDE.md

各 `packages/*/CLAUDE.md` にモジュール固有のコンテキストを記載。
開発時はルートCLAUDE.mdと対象モジュールのCLAUDE.mdを両方参照すること。
