# 第5回設計レビュー対応記録（最終）

| 項目 | 内容 |
|------|------|
| レビュー日 | 2026-05-11 |
| レビュワー | ChatGPT — 第5回 |
| 判定 | **レビューサイクル終了** |

## 収束判定

5回目のレビューで指摘の大半が前4回の繰り返しとなった。
新規で設計に反映すべき項目は3件のみ:

1. transcript_access join table（C-004）
2. OpenAI silence連続投入の明文化（M-014）
3. unit economics sheet作成（C-005）

上記3件を反映済み。これ以上のレビューは同じ指摘の再出にとどまるため、設計フェーズを完全に終了しPhase 1a実装に移行する。

## 新規対応（3件）

### transcript_access join table

architecture.mdに`trancall_transcript.transcript_access`テーブルを追加。
- segment本体はimmutable
- ユーザーごとの可視性・削除・export権限はaccess tableで管理
- 片方が削除しても相手のaccess行は影響しない
- RLSはこのテーブルをjoinして可視性を判定

### silence連続投入

architecture.mdに追記。OpenAI Realtime Translationは音声+silence連続ストリームを前提とする。
- Agent側のVADは翻訳停止判定に使わない
- silence paddingを含めて連続送信
- barge-in時はOpenAI側が自動処理

### unit economics sheet

docs/unit-economics.md を新規作成。
- 翻訳のみ / 翻訳+Whisper の原価計算
- プラン別粗利分析（30%/15%手数料）
- 為替感応度分析
- 結論: Whisperは品質fallbackのみ、Business含有分は要注意

## 繰り返し指摘（対応不要）

以下は前4回で対応済み:
- signaling残存 → 物理削除は実装開始時
- レイテンシー実測 → Phase 1a最初のタスク
- Node Agent安定性 → TS確定、リスク許容
- CallKit検証 → Phase 1a前半で検証
- assertionStyle → adapters例外明記済み
- E2EE表現 → Transport encryption明記済み
- MVP範囲 → 現Phase 1a範囲で確定
- ambient passthrough → 30%統一済み
- プラン表 → 30/120/500統一済み

## 質問への回答

| ID | 回答 | 前回回答 |
|----|------|---------|
| Q-001 | PoC未実施。Phase 1a初期で実測 | v4 Q-001 |
| Q-002 | 比較後に決定 | v4同様 |
| Q-003 | input transcript優先、Whisperはfallback | v4で決定 |
| Q-004 | 30% worst-case前提。SBP取得を目指す | 新規→反映済み |
| Q-005 | Phase 1はB2C履歴。B2B監査はPhase 4 | v4 Q-009 |
| Q-006 | 日本のみ | v3 Q-001 |
| Q-007 | Phase 2でグループ、SIPは将来検討 | v3 Q-010 |
| Q-008 | Tier 1開始、ピーク同時10通話から | v3 Q-002 |

## 5回レビュー累計

| 回 | Critical | Major | Minor | Good | 新規設計変更 |
|----|----------|-------|-------|------|------------|
| 1 | 5 | 12 | 9 | 7 | 多い |
| 2 | 5 | 16 | 10 | 10 | 多い（API仕様） |
| 3 | 6 | 14 | 13 | 12 | 少ない |
| 4 | 8 | 12 | 14 | 11 | ほぼなし |
| 5 | 6 | 14 | 10 | 10 | 3件のみ |
| **合計** | **30** | **68** | **56** | **50** |

**全204件の指摘・評価に対応完了。設計フェーズ終了。Phase 1a実装に移行する。**
