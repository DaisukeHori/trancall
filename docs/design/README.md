# TranCall Design System

Claude Designでのデザイン開発用テンプレートとトークン定義を格納する。

## ディレクトリ構造

```
docs/design/
├── README.md              # このファイル
├── tokens.md              # デザイントークン（色、タイポグラフィ、スペーシング）
├── foundations.md          # デザイン原則、アクセシビリティ方針
├── components/            # コンポーネント定義
│   ├── button.md
│   ├── input.md
│   ├── avatar.md
│   ├── call-card.md
│   ├── subtitle-overlay.md
│   ├── contact-row.md
│   ├── plan-card.md
│   └── ...
├── screens/               # 画面単位のデザイン仕様
│   ├── onboarding.md
│   ├── home.md
│   ├── in-call.md
│   ├── incoming-call.md
│   ├── contacts.md
│   ├── add-contact.md
│   ├── contact-profile.md
│   ├── pre-call-setup.md
│   ├── calling-ringing.md
│   ├── call-summary.md
│   ├── full-transcript.md
│   └── settings.md
└── flows/                 # ユーザーフロー・インタラクション定義
    ├── add-contact-flow.md
    ├── call-flow.md
    └── onboarding-flow.md
```

## 運用ルール

- 各コンポーネントの `.md` にはClaude Designへの指示として使えるプロンプト形式で記述する
- ワイヤーフレームの画面IDと一致させること（SCR-001〜SCR-012）
- デザイントークンは `tokens.md` に集約し、コンポーネントから参照する
- ダーク/ライト両モード対応を必須とする

## デザイン方針

- iOS Human Interface Guidelines / Material Design 3 を参考にしつつ、TranCall独自のブランドアイデンティティを確立
- 通話中のUIはミニマルに — 字幕表示が主役、コントロールは必要最小限
- 翻訳状態（ON/OFF、言語ペア、コスト）は常にユーザーが認識できるようにする
- アクセシビリティ: WCAG 2.1 AA準拠を目標
