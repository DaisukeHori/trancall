# Transcript Package Fonts

このディレクトリには PDF エクスポートで使用するフォントファイルを格納しています。

## 収録フォント

| ファイル | バージョン | ライセンス | 配布元 |
|---|---|---|---|
| `SourceHanSans-Regular.otf` | 2.005R | SIL OFL 1.1 | https://github.com/adobe-fonts/source-han-sans |
| `SourceHanSans-Bold.otf` | 2.005R | SIL OFL 1.1 | https://github.com/adobe-fonts/source-han-sans |
| `NotoSansDevanagari-Regular.ttf` | 2.006 | SIL OFL 1.1 | https://github.com/notofonts/devanagari |
| `NotoSansArabic-Regular.ttf` | 2.009 | SIL OFL 1.1 | https://github.com/notofonts/noto-fonts |

## ライセンス

### Source Han Sans (Adobe)

SIL Open Font License 1.1 (OFL-1.1)
Copyright 2014-2021 Adobe (http://www.adobe.com/)

全文: https://github.com/adobe-fonts/source-han-sans/blob/master/LICENSE.md

### Noto Sans Devanagari (Google / Noto Fonts Project)

SIL Open Font License 1.1 (OFL-1.1)
Copyright 2022 The Noto Project Authors (https://github.com/notofonts/devanagari)

全文: https://github.com/notofonts/devanagari/blob/main/OFL.txt

### Noto Sans Arabic (Google / Noto Fonts Project)

SIL Open Font License 1.1 (OFL-1.1)
Copyright 2015-2021 Google LLC. All Rights Reserved.

取得元: https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSansArabic
全文: https://github.com/notofonts/noto-fonts/blob/main/LICENSE

## 用途

- `SourceHanSans-Regular.otf` / `SourceHanSans-Bold.otf`: 日本語・中国語・韓国語・欧文全般
- `NotoSansDevanagari-Regular.ttf`: ヒンディー語 (हिन्दी) 原文テキスト表示用
- `NotoSansArabic-Regular.ttf`: アラビア語テキスト表示用 (transcript-export-spec.md §5.2 準拠)

## ファイルサイズ

- `SourceHanSans-Regular.otf`: ~16MB
- `SourceHanSans-Bold.otf`: ~16MB
- `NotoSansDevanagari-Regular.ttf`: ~275KB
- `NotoSansArabic-Regular.ttf`: ~235KB
- 合計: ~32.5MB (Vercel function 50MB 上限内)

## 既知の設計書 stale 事項

- `docs/module-contracts.md §2.6` の `exportTranscript` 戻り型は `{ contentBase64, mime }` だが、`docs/transcript-export-spec.md §2.1` (canonical) は `{ contentBase64, mime, filename }`。
- 本 package は spec 優先で `filename` を含めて実装。
- `docs/module-contracts.md` v1.4.0 (Sprint 3 完了同期、T-29) で修正予定。
