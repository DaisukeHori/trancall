# 第5回設計レビュー対応記録

| 項目 | 内容 |
|------|------|
| レビュー日 | 2026-05-11 |
| レビュワー | ChatGPT — 第5回 |
| 判定 | **レビューサイクル終了。実装フェーズへ移行。** |

## 判定根拠

5回目のレビューで新しい設計変更の指摘はゼロ。全指摘が前回までの対応の反映漏れ（ドキュメント間不整合）である。

この種の不整合は、4つの設計ドキュメントを手動で同期する限り解消しない。
解決策は実装（`@trancall/*` パッケージとしてコード化）による一元管理である。

## 残存する不整合（実装時に解消）

| 不整合 | 解消方法 |
|--------|---------|
| signaling が依存図に残存 | packages/signaling を物理削除 |
| passthrough 20/30% 混在 | media adapter実装時に30%で統一 |
| 字幕経路（Supabase Realtime vs LiveKit data channel） | 実装時にLiveKit data channel採用を確定 |
| schemas.tsとDB設計の差分 | @trancall/contracts パッケージで一元管理 |
| usage_recordsの構造 | billing実装時にheartbeat/reservation/reconcile構造を確定 |
| transcript_access テーブル不在 | transcript実装時に追加 |

## 質問への回答

| ID | 回答 |
|----|------|
| Q-001 | PoCは未実施。Phase 1aの最初のタスク |
| Q-002 | 比較後に決定。第一候補は未定 |
| Q-003 | input transcriptを優先。whisperはfallback |
| Q-004 | 30% worst-caseを前提に設計 |
| Q-005 | Phase 1はB2C便利な履歴。B2B監査ログはPhase 4 |
| Q-006 | Phase 1は日本のみ |
| Q-007 | Phase 2でgroup call予定。SIP/PSTNは未定 |
| Q-008 | OpenAI Tier 1（50 audio min/min）。同時10通話程度から開始 |

## 5回レビュー累計

| 指摘種別 | 合計 |
|---------|------|
| Critical | 32 |
| Major | 66 |
| Minor | 60 |
| Good | 51 |
| 質問 | 39 |
| **合計** | **248** |

設計フェーズ完了。Phase 1a実装に移行する。
