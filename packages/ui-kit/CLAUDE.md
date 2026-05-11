# CLAUDE.md — @trancall/ui-kit

## モジュール概要
TranCall全体で使用する共通UIコンポーネントライブラリ（React Native）。

## 責務
- デザインシステムのトークン定義
- 共通コンポーネント（Button, Input, Avatar, Badge, Card等）
- 通話固有コンポーネント（SubtitleOverlay, CallCard, ContactRow, PlanCard）
- ダーク/ライトモード対応
- i18n対応コンポーネント

## 参照
- デザイントークン: `docs/design/tokens.md`
- コンポーネント仕様: `docs/design/components/`

## 注意事項
- ビジネスロジックを含めない（表示のみ）
- アクセシビリティ（WCAG 2.1 AA）を各コンポーネントで確保
