# TranCall

**すべての通話を、自分の言語で。**

TranCallはGPT-Realtime-Translateを活用したリアルタイム翻訳付きVoIP通話アプリです。ユーザーは自分のネイティブ言語で話し、相手には相手の言語に翻訳された音声が届きます。

## 特徴

- リアルタイム双方向音声翻訳（GPT-Realtime-Translate、13出力言語対応）
- リアルタイム字幕表示（原文 + 翻訳文）
- 通話後トランスクリプト保存・検索・エクスポート（PDF/TXT）
- クロスプラットフォーム（iOS / Android、将来macOS / Windows）
- VoIP Push対応（アプリkill状態でも着信通知）

## 対応言語

**入力**: 70以上（自動検出対応）

**出力**: English, Español, Português, Français, 日本語, Русский, 中文, Deutsch, 한국어, हिन्दी, Bahasa Indonesia, Tiếng Việt, Italiano


## 差別化（2026年5月時点）

Apple Phone Live Translation（iOS 26〜）との比較:

| | TranCall | Apple純正 |
|---|---|---|
| 対応端末 | **全iOS + 全Android** | iPhone 15 Pro以降のみ |
| 通話チャネル | **VoIP（データ通信）** | **電話回線（音声通話）のみ** |
| 通話コスト | データ通信料のみ（実質ゼロ円〜数百円/月） | **国際電話料金（最大400円/分）** |
| 日本語対応（2026/5） | **入力70+ / 出力13言語** | 5言語（英米/英英/仏/独/葡/西）日本語未対応 |
| トランスクリプト | **保存・検索・エクスポート** | 保存なし（オンデバイス） |
| プライバシー | クラウド処理（同意制） | オンデバイス |
| B2B機能 | 通話ログ・監査・検索 | なし |

**Apple Phone Live Translation の制約**:
- **電話回線（音声通話）でのみ動作** — VoIPアプリ（LINE、WhatsApp、Zoom等）には適用されない。
- **国際電話料金が高い** — KDDI/NTTドコモ/ソフトバンクのスタンダードプラン国際電話料金は1分あたり数十円〜400円超（米国 約60円/分、中国 約160円/分、ベトナム 約260円/分など。発信元地域・契約プラン・割引適用有無で変動）。30分通話で1,800円〜12,000円規模になり得る。
- **日本語が未対応**（2026年5月時点、対応5言語は英国・米国英語、仏・独・葡・西）。AirPods Live Translation は EU 提供外、年内に日本語対応予定とアナウンス。
- iPhone 15 Pro 以降のみ（Apple Intelligence 必須）。

TranCallの主要ターゲット:
1. iPhone 15 Pro未満 / Android（Apple Intelligence非対応）
2. B2Bログ・トランスクリプト要件
3. VoIP経済圏（国際電話料金を避けたいユーザー）
4. 日本語を含む多言語コミュニケーション（Apple純正で未対応）

## アーキテクチャ

モジュラーモノリス + Zodスキーマによる型安全なモジュール境界

```
trancall/
├── packages/           # ドメインモジュール（10モジュール）
│   ├── shared-kernel/  # 共通型・EventBus・DI
│   ├── auth/           # 認証・ユーザー管理
│   ├── room/           # 通話セッション管理
│   ├── media/          # 音声トラック抽象化 + Transport Adapter
│   ├── translation/    # GPT-RT-Translate接続
│   ├── billing/        # 課金（Stripe + IAP）
│   ├── contact/        # 連絡先管理
│   ├── notification/   # Push通知（APNs + FCM）
│   ├── transcript/     # 字幕・文字起こし
│   └── ui-kit/         # 共通UIコンポーネント
├── apps/
│   ├── mobile/         # React Native + Expo（iOS / Android）
│   ├── desktop/        # Electron（macOS / Windows）— Phase 3
│   ├── server/         # Node.js APIサーバー
│   └── translation-agent/  # LiveKit Agent（翻訳ワーカー）
└── docs/
    ├── requirements.md     # 要件定義書
    ├── architecture.md     # アーキテクチャ設計書
    ├── schemas.ts          # Zodスキーマリファレンス
    └── design/             # ワイヤーフレーム・デザインシステム
```

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| モバイル | React Native + Expo |
| デスクトップ | Electron（Phase 3） |
| SFU | LiveKit |
| 翻訳エンジン | OpenAI GPT-Realtime-Translate |
| Translation Agent | LiveKit Agent Framework (TypeScript) |
| APIサーバー | Node.js (TypeScript) |
| DB / Auth | Supabase (PostgreSQL) |
| 課金 | Stripe + iOS IAP + Google Play IAP |
| Push通知 | APNs VoIP Push + FCM |
| i18n | i18next + expo-localization |
| バリデーション | Zod v4 |
| monorepo | Turborepo + pnpm |

## 開発ルール

- `as any` / `as unknown` / `@ts-ignore` 全面禁止
- 全モジュール境界はZodスキーマで定義
- 例外throwの代わりにResult型（discriminated union）を使用
- TSConfig: `strict: true`, `noUncheckedIndexedAccess: true`
- 詳細は [CLAUDE.md](./CLAUDE.md) を参照

## フェーズ

| Phase | 内容 | 状態 |
|-------|------|------|
| Phase 1 | 1対1音声通話 + 翻訳 + 課金（iOS/Android） | 設計中 |
| Phase 2 | グループ通話 + ビデオ + WeChat/LINE対応 | 計画中 |
| Phase 3 | デスクトップ（macOS / Windows） | 計画中 |
| Phase 4 | エンタープライズ（管理画面、SSO、用語集） | 計画中 |

## ドキュメント

- [要件定義書](./docs/requirements.md)
- [アーキテクチャ設計書](./docs/architecture.md)
- [Zodスキーマリファレンス](./docs/schemas.ts)
- [デザインシステム](./docs/design/README.md)
- [ワイヤーフレーム](./docs/design/wireframes/)

## ライセンス

Private — All rights reserved.
