# TranCall デザイントークン

## カラーパレット

### Light Mode

| トークン | 値 | 用途 |
|---------|-----|------|
| --color-primary | #0A7AFF | CTAボタン、アクティブタブ、リンク |
| --color-primary-bg | #E6F1FB | バッジ背景、選択状態 |
| --color-success | #34C759 | 通話中、翻訳アクティブ、応答ボタン |
| --color-success-bg | #EAF3DE | 成功バッジ |
| --color-danger | #FF3B30 | 終話ボタン、エラー、不在着信 |
| --color-danger-bg | #FCEBEB | エラーバッジ |
| --color-warning | #FF9500 | 翻訳遅延、残量少 |
| --color-warning-bg | #FAEEDA | 警告バッジ |
| --color-bg-primary | #FFFFFF | 画面背景 |
| --color-bg-secondary | #F5F5F5 | カード背景、通話画面背景 |
| --color-bg-tertiary | #E8E8E8 | セパレーター |
| --color-text-primary | #1A1A1A | 本文 |
| --color-text-secondary | #8E8E93 | サブテキスト、ラベル |
| --color-text-tertiary | #C7C7CC | プレースホルダー |
| --color-border | #E5E5EA | ボーダー、ディバイダー |

### Dark Mode

| トークン | 値 |
|---------|-----|
| --color-primary | #64B5F6 |
| --color-primary-bg | #0C447C |
| --color-bg-primary | #1C1C1E |
| --color-bg-secondary | #2C2C2E |
| --color-bg-tertiary | #3A3A3C |
| --color-text-primary | #F5F5F5 |
| --color-text-secondary | #8E8E93 |
| --color-text-tertiary | #636366 |
| --color-border | #38383A |

## タイポグラフィ

| トークン | サイズ | 太さ | 用途 |
|---------|--------|------|------|
| --font-title | 28px | 700 | 画面タイトル（Home, Settings） |
| --font-heading | 18px | 600 | セクションヘッダー |
| --font-body | 16px | 400 | 本文 |
| --font-body-small | 14px | 400 | サブテキスト |
| --font-caption | 12px | 400 | バッジ、タイムスタンプ |
| --font-caption-small | 10px | 500 | ナビラベル |
| --font-mono | 14px | 500 (monospace) | 通話タイマー |

フォント: System default（iOS: SF Pro, Android: Roboto）

## スペーシング

| トークン | 値 | 用途 |
|---------|-----|------|
| --space-xs | 4px | アイコンとテキストの間 |
| --space-sm | 8px | リスト項目間 |
| --space-md | 12px | セクション内パディング |
| --space-lg | 16px | 画面パディング |
| --space-xl | 24px | セクション間 |
| --space-2xl | 32px | 大きな区切り |

## 角丸

| トークン | 値 | 用途 |
|---------|-----|------|
| --radius-sm | 8px | ボタン、入力フィールド |
| --radius-md | 12px | カード |
| --radius-lg | 16px | モーダル |
| --radius-full | 9999px | アバター、バッジ |

## 通話固有トークン

| トークン | 値 | 用途 |
|---------|-----|------|
| --subtitle-bg | rgba(0,0,0,0.7) | 字幕背景（通話画面オーバーレイ） |
| --subtitle-text | #FFFFFF | 字幕テキスト |
| --subtitle-original | #AAAAAA | 原文テキスト |
| --subtitle-translated | #FFFFFF | 翻訳テキスト |
| --subtitle-loading | 点滅アニメーション | partial delta 表示中 |
| --subtitle-final | 実線ボーダー | final segment 確定 |
| --ambient-volume-normal | 0.3 | 原音パススルー通常 |
| --ambient-volume-ducking | 0.1 | 翻訳音声到着時 |
| --ambient-volume-fallback | 1.0 | 翻訳停止時 |
| --call-action-size | 56px | 通話ボタン（応答/終話） |
| --call-control-size | 48px | ミュート/スピーカー等 |
