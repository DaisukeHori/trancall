# CLAUDE.md — TranCall

## プロジェクト概要

TranCallはGPT-Realtime-Translateを活用したリアルタイム翻訳付きVoIP通話アプリ。
モジュラーモノリスアーキテクチャで構築し、Zodスキーマで全モジュール境界を定義する。

## リポジトリ構造

```
trancall/
├── docs/                          # プロジェクトドキュメント
│   ├── requirements.md            # 要件定義書
│   ├── architecture.md            # アーキテクチャ設計書
│   └── design/                    # Claude Design テンプレート
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
- 型アサーション (`as SomeType`) も禁止 — ESLint `assertionStyle: "never"`
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

## 技術スタック

- Runtime: Node.js 22+
- Package Manager: pnpm
- Monorepo: Turborepo
- Mobile: React Native + Expo SDK 53+
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
