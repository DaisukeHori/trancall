# Transcript Export 仕様 (PDF / TXT)

| 項目 | 内容 |
|------|------|
| ドキュメント ID | TRANSCRIPT-EXPORT-001 |
| Status | Draft v1.0 (2026-05-12) |
| Sprint | Sprint 2 R1 補追 (A-8 TODO 対応) |
| 上位文書 | `docs/module-contracts.md` v1.3.0 §2.6 TranscriptFacade / `docs/architecture.md` §6.2 `trancall_transcript.segments` |
| 関連文書 | `docs/billing-ui-flow.md` v1.3 (プラン別 retention) / `docs/legal-and-consent.md` v1.2 (consent_version 記載) / `docs/design/design-system.md` (UI トークン) |
| 下位実装対象 | `packages/transcript/src/services/export-service.ts` (新規、Sprint 3 実装) / `packages/transcript/src/facade.ts` の `exportTranscript()` (現状 501 stub を実装) |

---

## 目次

1. スコープと位置付け
2. 入出力仕様
3. PDF レイアウト spec
4. TXT format spec
5. 多言語フォント戦略
6. 出力ファイル名規則
7. 含めるデータ / 含めないデータ (PII 配慮)
8. エラー処理
9. テスト戦略
10. 改訂履歴

---

## 1. スコープと位置付け

### 1.1 本書の責務

`TranscriptFacade.exportTranscript(roomId, userId, format)` の **出力フォーマット仕様** を canonical 化する。Sprint 1 で facade interface は確定 (`module-contracts.md` §2.6) しているが、実体は `TRANSCRIPT_EXPORT_NOT_IMPLEMENTED` を返す 501 stub。Phase 1a P1 (Sprint 2/3) で実装するための仕様 spec。

### 1.2 非スコープ

- TranscriptFacade の interface 変更 (`module-contracts.md` v1.3.0 §2.6 が canonical)
- DB 構造変更 (`segments` テーブル既存定義のまま使用)
- 字幕配信 (LiveKit Data Channel) 仕様 — `module-contracts.md` §3.4 が canonical

---

## 2. 入出力仕様

### 2.1 facade signature

> **M-3 (分割エクスポート) 実装済み**: 1000 segments 超の長時間通話は `TRANSCRIPT_EXPORT_TOO_LARGE`
> ハードエラーではなく、`MAX_SEGMENTS_PER_EXPORT_PART=1000` 件ごとの複数パートに分割して
> エクスポートするようになった。`partIndex` (0-based、省略時 0) 未指定・かつ segments が
> 1000 件以下の場合は `totalParts=1` / `hasMore=false` となり、**既存の単発エクスポートと
> 完全に後方互換** (呼び出し側の変更は任意)。

```ts
exportTranscript(
  roomId: RoomId,
  userId: UserId,
  format: "pdf" | "txt",
  partIndex?: number,
): Promise<Result<{
  contentBase64: string;
  mime: string;
  filename: string;
  /** 0-based。今回返したパートの番号 */
  partIndex: number;
  /** 総パート数 (1 = 分割不要) */
  totalParts: number;
  /** true の場合、partIndex+1 で追加のパートが取得できる */
  hasMore: boolean;
  /** room 全体のセグメント総数 (パート分割前) */
  totalSegments: number;
}, AppError>>;
```

戻り値:
- `contentBase64`: 出力ファイルを base64 エンコードした文字列 (mobile が `expo-file-system` で復号して保存)
- `mime`: `application/pdf` または `text/plain; charset=utf-8`
- `filename`: §6 の命名規則 (`totalParts > 1` の場合は `-part{N}of{M}` サフィックスが付く、§6.1 参照)
- `partIndex` / `totalParts` / `hasMore` / `totalSegments`: M-3 で追加。呼び出し側 (apps/server の
  `GET /api/transcripts/:roomId/export?part=N`) は `hasMore=true` の間 `part` をインクリメントしながら
  追加リクエストすることで全パートを取得する

エラー:
- `TRANSCRIPT_EXPORT_FORBIDDEN`: `transcript_access.can_view=false` または `deleted_at IS NOT NULL`
- `TRANSCRIPT_EXPORT_EMPTY`: segments が 0 件 (該当 room の参加者だが録音されていない)
- `TRANSCRIPT_EXPORT_INVALID_PART`: `partIndex` が `0〜totalParts-1` の範囲外、または非整数 (M-3 で追加。旧 `TRANSCRIPT_EXPORT_TOO_LARGE` はこの分割エクスポート実装により facade からは返されなくなった — §8 参照)
- `INTERNAL_ERROR`: PDF 生成失敗等

### 2.2 入力データソース

```sql
-- 出力対象セグメント取得
SELECT
  segment_id,
  participant_id,
  speaker_name,
  original_text,
  translated_text,
  language_pair,
  start_time_ms,
  end_time_ms,
  sequence_no
FROM trancall_transcript.segments
WHERE room_id = $1
  AND EXISTS (
    SELECT 1 FROM trancall_transcript.transcript_access
    WHERE room_id = $1 AND user_id = $2
      AND can_view = true AND deleted_at IS NULL
  )
ORDER BY sequence_no ASC;
```

加えて room メタデータ:

```sql
SELECT r.room_id, r.room_type, r.created_at, r.ended_at,
       p_self.display_name AS my_name,
       array_agg(DISTINCT p_other.display_name) AS other_names
FROM trancall_room.rooms r
JOIN trancall_room.participants me ON me.room_id = r.room_id AND me.user_id = $2
JOIN trancall_auth.profiles p_self ON p_self.user_id = $2
LEFT JOIN trancall_room.participants others ON others.room_id = r.room_id AND others.user_id != $2
LEFT JOIN trancall_auth.profiles p_other ON p_other.user_id = others.user_id
WHERE r.room_id = $1
GROUP BY r.room_id, p_self.display_name;
```

---

## 3. PDF レイアウト spec

### 3.1 採用ライブラリ

- **pdfkit** (Node.js、Sprint 3 で `packages/transcript/package.json` に追加) を採用
- 採用理由: 多言語フォント埋込、表組み、ヘッダ/フッタ制御が成熟、ライセンス MIT
- 代替検討: `pdf-lib` (フォント埋込弱)、`puppeteer` (Vercel Serverless で起動コスト過大) はいずれも採用しない

### 3.2 ページレイアウト (A4 縦)

```
┌──────────────────────────────────────────────┐ ← Top margin: 20mm
│  TranCall                  [trancall-mark]   │
│  通話トランスクリプト                          │ ← Header (font: SourceHanSans 14pt bold)
├──────────────────────────────────────────────┤
│                                                │
│  通話日時: 2026-05-12 10:00:00 JST            │
│  参加者: 自分 (山田太郎), John Wang           │ ← Meta info (font: 10pt)
│  通話時間: 5 分 32 秒                          │
│  翻訳ペア: ja → en, en → ja                   │
│                                                │
├──────────────────────────────────────────────┤
│                                                │ ← Body
│  [00:00:03] 山田太郎 (ja → en)                │ ← Speaker line (font: 10pt bold)
│    こんにちは、お元気ですか？                   │ ← Original (font: 11pt regular)
│    "Hello, how are you?"                        │ ← Translated (font: 11pt italic、灰色)
│                                                │
│  [00:00:08] John Wang (en → ja)               │
│    "I'm doing well, thank you."                │
│    元気です、ありがとう。                       │
│                                                │
│  ... (繰り返し)                                │
│                                                │
├──────────────────────────────────────────────┤
│  Page 1 of N             TranCall (c) 2026   │ ← Footer (font: 8pt grey)
└──────────────────────────────────────────────┘ ← Bottom margin: 20mm
```

- ヘッダ: TranCall ロゴ + 文書タイトル、各ページ繰り返し
- フッタ: ページ番号 + (c) 表記
- 行間: 1.4em
- ページ送り: segments が改ページを跨ぐ場合、speaker line を切らない (`pdfkit` の `keepTogether` 相当を実装)

### 3.3 PDF メタデータ

```ts
doc.info = {
  Title: `TranCall Transcript - ${roomId.slice(0, 8)}`,
  Author: "TranCall",
  Subject: `Translation call between ${myName} and ${otherNames.join(", ")}`,
  Creator: "TranCall Server v1.0",
  Producer: "pdfkit",
  CreationDate: new Date(callEndedAt),
};
```

PDF 自体に **暗号化はかけない** (Phase 1a スコープ外、Phase 1c で `pdfkit` password 機能検討)。ただし mobile 側で `expo-file-system` 保存時にデバイスのファイルシステム暗号化に依存。

---

## 4. TXT format spec

シンプルなプレーンテキスト出力。多言語フォントは UTF-8 で表現可能なため、ライブラリ不要 (Node.js 標準 `fs.writeFile`)。

### 4.1 出力サンプル

```
==============================================
TranCall 通話トランスクリプト
==============================================

通話日時: 2026-05-12 10:00:00 JST
参加者: 自分 (山田太郎), John Wang
通話時間: 5 分 32 秒
翻訳ペア: ja -> en, en -> ja

==============================================

[00:00:03] 山田太郎 (ja -> en)
  原文: こんにちは、お元気ですか？
  翻訳: Hello, how are you?

[00:00:08] John Wang (en -> ja)
  原文: I'm doing well, thank you.
  翻訳: 元気です、ありがとう。

[00:00:13] 山田太郎 (ja -> en)
  原文: ...
  翻訳: ...

(以下同様)

==============================================
TranCall (c) 2026 — Generated at 2026-05-12 10:06:00 JST
==============================================
```

### 4.2 改行コード

- `\n` (LF 単独、Unix/macOS/Linux 標準)
- Windows 互換性はクライアント側 (mobile が `expo-file-system` で保存後、ユーザーが PC に転送した場合) に委ねる

### 4.3 文字エンコーディング

- **UTF-8 with BOM** (Excel / Windows メモ帳での文字化け防止)

---

## 5. 多言語フォント戦略

### 5.1 必要言語

13 出力言語 (English, Español, Português, Français, 日本語, Русский, 中文, Deutsch, 한국어, हिन्दी, Bahasa Indonesia, Tiếng Việt, Italiano) + 70+ 入力言語の原文。

### 5.2 PDF フォント

**Source Han Sans (Adobe Open Source、SIL OFL 1.1 license)** を採用:
- `SourceHanSans-Regular.otf`: 全言語カバー (日本語 / 韓国語 / 中国語簡体・繁体)
- `SourceHanSans-Bold.otf`: 同上
- `NotoSansDevanagari-Regular.ttf`: हिन्दी 用 (Source Han Sans でカバーされない)
- `NotoSansArabic-Regular.ttf`: アラビア語等 (入力言語、出力対象外だが原文表示に必要)

サイズ: 各 ~10MB、計 30MB 程度 → `packages/transcript/fonts/` に同梱 (Sprint 3 で実装)、Vercel function サイズ制限 (50MB) 内に収まる。

### 5.3 TXT フォント

UTF-8 のため不要 (システムフォントに依存)。

---

## 6. 出力ファイル名規則

```
trancall-transcript-<YYYYMMDD>-<HHmm>-<roomId-8chars>.<ext>
```

例: `trancall-transcript-20260512-1000-550e8400.pdf`

- `<YYYYMMDD>`: 通話開始日 (JST)
- `<HHmm>`: 通話開始時刻 (JST、4 桁)
- `<roomId-8chars>`: roomId の先頭 8 文字 (重複避け)
- `<ext>`: `pdf` または `txt`

mobile 側で `expo-file-system` に保存後、ユーザーが共有シートで AirDrop / メール添付等で外部出力。

### 6.1 分割エクスポート時のファイル名 (M-3)

`totalParts > 1` の場合、拡張子の直前に `-part{N}of{M}` (1-based) を挿入する:

```
trancall-transcript-<YYYYMMDD>-<HHmm>-<roomId-8chars>-part{N}of{M}.<ext>
```

例: `trancall-transcript-20260512-1000-550e8400-part1of2.pdf` / `...-part2of2.pdf`

`totalParts === 1` (1000 segments 以下) の場合は §6 の従来通りのファイル名のまま (サフィックスなし)。

---

## 7. 含めるデータ / 含めないデータ (PII 配慮)

### 7.1 含める

- 自分と相手の表示名 (`profiles.display_name`)
- 通話日時 (`rooms.created_at` / `ended_at`)
- 全 segments (自分が `transcript_access` で `can_view=true` の room のみ)
- 翻訳ペア (`language_pair`)
- 各 segment のタイムスタンプ (`start_time_ms`)

### 7.2 含めない

- 相手の `trancallId` (@username) — プライバシー配慮、相手が公開設定変更前提
- IP アドレス / User-Agent (consent 監査証跡だがエクスポート対象外)
- 通話音声 (Phase 1a スコープ外、TranCall は音声非保存)
- 課金情報 (cost、subscription tier 等)
- 内部 ID (`segment_id`, `room_id` 完全形)

### 7.3 同意バージョン記載

PDF / TXT 末尾に「本トランスクリプトは利用規約 v{X.Y.Z} およびプライバシーポリシー v{X.Y.Z} に同意のうえ生成されました」を出力 (法務記録目的、`docs/legal-and-consent.md` v1.2 §14 連動)。

---

## 8. エラー処理

| 状況 | error code | UI 動作 |
|---|---|---|
| `transcript_access.can_view = false` | `TRANSCRIPT_EXPORT_FORBIDDEN` | 「閲覧権限がありません」toast、Home に戻る |
| `transcript_access.deleted_at IS NOT NULL` | `TRANSCRIPT_EXPORT_FORBIDDEN` | 同上 |
| segments 0 件 | `TRANSCRIPT_EXPORT_EMPTY` | 「録音された会話がありません」toast |
| segments > 1000 件 (M-3 以前の旧挙動) | ~~`TRANSCRIPT_EXPORT_TOO_LARGE`~~ | **廃止 (M-3)**: 1000 件超は自動的に複数パートへ分割エクスポートされるようになったため、facade からは返されなくなった (§2.1 参照)。`apps/server/src/middleware/error-handler.ts` のマッピングは既存クライアント互換のため残置 |
| `partIndex` が範囲外/非整数 (M-3) | `TRANSCRIPT_EXPORT_INVALID_PART` (400) | 「指定されたページが見つかりません」toast (通常は mobile 側のページング UI バグ以外では発生しない) |
| PDF 生成失敗 (フォント読込エラー等) | `INTERNAL_ERROR` | 「エクスポートに失敗しました、後でやり直してください」 |
| 多言語フォント不在 (Devanagari 等) | `INTERNAL_ERROR` | 同上 + Sentry に詳細ログ |

新規 error code 3 種は `docs/module-contracts.md` v1.4.0 (Sprint 3 同期時) に追加予定。

---

## 9. テスト戦略

### 9.1 unit

- pdfkit 生成: 各種言語 (ja / en / zh / ko / hi) の混在テキストを含む 10 segments を生成し PDF 出力後、`pdf-parse` で抽出して内容一致確認
- txt 生成: 同上を txt 出力後、UTF-8 BOM 確認 + 文字列一致確認

### 9.2 integration

- `packages/integration-tests/__tests__/transcript-export.integration.test.ts` (Sprint 3 新規)
- DB に 100 segments を seed → exportTranscript("pdf") / ("txt") の両方を呼び出し、Result.ok 確認 + filename 命名規則確認 + base64 デコードでバイナリ取得確認

### 9.3 E2E (Maestro、Phase 1b スコープ)

- `e2e/transcript-export.yaml`: SCR-012 Full Transcript 画面 → 「エクスポート」ボタン → PDF / TXT 選択 → 共有シート起動確認

### 9.4 多言語スクリーンショット試験

Sprint 3 末で 13 出力言語 + 主要入力言語 (en / ja / zh / ko / ru / ar 等 5-6 言語) の混在 transcript を PDF 出力し、目視で文字化けなし確認 (`docs/translation-quality-qa.md` D10 と連動)。

---

## 10. 改訂履歴

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2026-05-12 | Sprint 2 R1 補追として新規作成 (A-8 TODO 対応)。`TranscriptFacade.exportTranscript()` (現状 501 stub) を Sprint 3 で実装するための PDF / TXT 出力 spec を canonical 化。pdfkit + Source Han Sans + Noto Sans 多言語フォント採用、A4 縦レイアウト、ファイル名規則、PII 配慮、エラー処理 3 種、テスト戦略を確定。 |
| v1.1 | 2026-07-11 | **M-3 (分割エクスポート) 実装完了**。§2.1: `exportTranscript` に `partIndex?: number` (0-based) 引数を追加し、戻り値に `partIndex`/`totalParts`/`hasMore`/`totalSegments` を追加 (既存呼び出し元との後方互換を維持)。§6.1 (新設): 分割時のファイル名 `-part{N}of{M}` サフィックス規則。§8: 旧 `TRANSCRIPT_EXPORT_TOO_LARGE` (1000 segments 超のハードエラー) を廃止し、新規 `TRANSCRIPT_EXPORT_INVALID_PART` (400、partIndex 範囲外) に置き換え。実装: `packages/transcript/src/facade.ts` (`MAX_SEGMENTS_PER_EXPORT_PART=1000`)、`apps/server/src/routes/transcript-routes.ts` (`part` query/body パラメータ追加)、`apps/server/src/middleware/error-handler.ts` (`TRANSCRIPT_EXPORT_INVALID_PART: 400` 追加)。単体テスト: `packages/transcript/__tests__/facade-export-pagination.test.ts` (14 tests)。 |
