# @trancall/ui-kit 設計書

## 責務
共通UIコンポーネント（React Native）。ビジネスロジック禁止。

## ディレクトリ
```
src/
├── index.ts
├── tokens/
│   ├── colors.ts         # Light/Dark カラーパレット
│   ├── typography.ts     # フォントサイズ・太さ
│   └── spacing.ts        # スペーシングスケール
├── components/
│   ├── Button.tsx
│   ├── Input.tsx
│   ├── Avatar.tsx
│   ├── Badge.tsx
│   ├── ContactRow.tsx
│   ├── CallCard.tsx
│   ├── PlanCard.tsx
│   └── SubtitleOverlay.tsx   # 通話中字幕表示
├── i18n/
│   ├── index.ts              # i18next初期化
│   └── locales/
│       ├── en.json
│       ├── ja.json
│       └── zh.json
└── hooks/
    └── useTheme.ts
```

## デザイントークン参照
docs/design/tokens.md を参照。React Native StyleSheetで実装。
