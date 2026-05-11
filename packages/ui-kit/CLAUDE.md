# CLAUDE.md — @trancall/ui-kit

## モジュール概要
TranCall全体で使用する共通UIコンポーネントライブラリ（React Native）。
モバイル (Phase 1) / デスクトップ (Phase 3) の双方が同じトークン・コンポーネントを使う。

## 責務
- デザイントークン定義 (`src/tokens.ts`): colors / spacing / typography / radii / callTokens
- light / dark テーマ (`src/theme/`)
- 共通コンポーネント (`src/components/`): Avatar / AvatarStack / Badge / Button / Card / Input / ContactRow / CallCard / SubtitleOverlay / LanguagePicker / PlanCard
- i18n (`src/i18n/locales/`): ja / en / zh の 3 言語、画面内に文言直書き禁止
- ブランドアセット (`assets/`): `trancall-icon.svg` / `trancall-mark.svg`
- アクセシビリティ (WCAG 2.1 AA) を全コンポーネントで確保

## 参照 (canonical UI 仕様)
- **`docs/design/design-system.md`** — 全画面の UI 仕様 (主要参照)
- `docs/design/colors_and_type.css` — CSS custom properties (web mirror)
- `docs/design/preview/*.html` — トークン/コンポーネント視覚プレビュー (20 件)
- `docs/design/SKILL.md` — Claude Design Skill manifest
- `apps/mobile/_design-ref/` — Layer 4 mobile mockup (RN 移植元、`_` prefix は実装参照素材を示す)

## トークン値 (`src/tokens.ts` が真、変更時は design-system.md と同期)
- **Primary**: `#0A7AFF` (light) / `#64B5F6` (dark)
- **Semantic**: success `#34C759` / danger `#FF3B30` / warning `#FF9500`
- **Spacing**: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64` (8 ステップ)
- **Radii**: `4 · 8 · 12 · 16 · full(9999)`
- **Typography**: heading1(28) / heading2(18) / heading3(16) / body(16) / bodySmall(14) / caption(12) / captionSmall(10) / mono(14)
- **CallTokens**: actionSize `56` / controlSize `48` / ambientVolumeNormal `0.3`

## 規約
- **ビジネスロジックを含めない** (表示のみ、Result 型や DB 操作は禁止)
- **TouchableOpacity** には必ず `accessibilityLabel` + `accessibilityRole` を設定
- **tabular-nums**: 経過時間 / 金額表示で位幅シフトしない
- **タップ領域**: 最小 44×44 (iOS HIG)、CallButton 56×56、通常コントロール 48×48
- **状態色**: 翻訳 ON `primary`、Translating `success`、Reconnecting `warning`、Stopped `danger`
- **emoji 禁止**: 文言には emoji 使用しない (例外: `LanguagePicker` の国旗 emoji のみ言語タグとして許可)
- **エラーメッセージ**: 原因+対処を併記 (`接続できません。ネットワークを確認してください。`)

## 禁止事項 (ブランド / コンプライアンス)
- Claude / Anthropic / OpenAI ロゴの画面表示 (consent 画面で "OpenAI" テキスト言及のみ可)
- 派手なアニメーション (許可: `degraded→recovered` 200-250ms cross-fade、`Reconnecting` 1.4s opacity pulse、bottom-sheet スライドのみ)
- 装飾 photography / gradient (例外: in-call の下部黒 protection gradient のみ)
- iOS-style backdrop-filter blur (Android RN で patchy なため不採用)
- 翻訳状態をあいまいに表示すること (常に明示的なバッジ必須)
