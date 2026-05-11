# 第6回設計レビュー対応記録

| 項目 | 内容 |
|------|------|
| レビュー日 | 2026-05-11 |
| レビュワー | Claude (Opus) — 第6回 |
| 特徴 | 外的環境変化（Apple Call Translation API, 日本MSCA, GPT-RT-Translate新規性）と実装基盤の欠如を指摘 |

## 反省

第5回までで「設計凍結」を宣言したのは早計だった。以下が未完だった:

1. schemas.tsがコンパイル不能なコードだった
2. monorepo scaffolding（package.json/turbo.json/CI等）が皆無
3. client-side sidecar案が公式非推奨なのに残っていた
4. Apple Call Translation APIが既にリリース済みなのに差別化分析が古かった
5. 日本MSCAを考慮していなかった
6. 言語ペア検出ロジックが未定義だった
7. Branded Typesの境界変換ヘルパーが未定義だった

---

## Critical 対応

### C-001: client-side sidecar削除

対応: **server-side Agent一本に確定**。

OpenAI公式: "WebSocket is not ideal for realtime audio over slower networks"
LiveKit公式: "WebSocket is best suited for server-to-server use rather than direct consumption by end-user devices"

client-side sidecar関連の記述を全ドキュメントから削除済み。

### C-002: Apple Call Translation API 対応

対応: **差別化戦略を再定義**。

Apple Call Translation APIはiOS 26で公開済み（現在5言語、拡大中）。
TranCallの差別化を以下に再定義:

1. iPhone 15 Pro未満 + Android全体（Apple Intelligence非対応端末）
2. トランスクリプト保存・検索・エクスポート（Apple純正は保存しない）
3. VoIP経済圏（国際電話料金 vs データ通信のみ）
4. B2Bログ・監査要件

README.mdに差別化テーブルを追加済み。

### C-003: @livekit/rtc-node Developer Preview

対応: **TypeScript第一候補を維持、Phase 1a終了条件にゲートを設定**。

translation-agent/CLAUDE.mdに以下を追加:
- 30分連続セッション安定動作
- メモリ512MB未満
- 上記未達ならPython版に切り替え

### C-004: 日本MSCA

対応: **unit-economics.mdにMSCAシナリオを追加**。

Phase 1cはIAP + MSCA 21%（SBP適用なら10%）で開始。
B2B向けはWebサブスク（Stripe 3.6%）を併設。

### C-005: 電気通信事業法

対応: **Phase 1a開始前に法務確認**。

TestFlight段階でも届出義務が発生する可能性あり。
Phase 1a開始前に30分のリーガルチェックを推奨（5-10万円）。

---

## Major 対応

### M-001: monorepo scaffolding

対応: **作成済み**。

- ルート package.json + pnpm-workspace.yaml + turbo.json
- tsconfig.base.json
- eslint.config.ts（assertionStyle例外含む）
- 全10パッケージ + 2アプリの package.json + tsconfig.json
- .github/workflows/ci.yml（lint, typecheck, test）
- shared-kernel実ソースコード（brand.ts, result.ts, language.ts, events.ts, index.ts）

### M-002: schemas.ts コンパイル不能

対応: **完全書き直し（655行）**。

- ResultOf<S> ヘルパー型で全Facade定義を修正
- AudioFrameはinterfaceに変更（Zodから除外、hot path対策）
- LiveSubtitleDelta と TranscriptSegment を分離
- BlockUserCommand, ReportUserCommand 追加
- TranslationDegradedEvent, TranslationRecoveredEvent 追加
- cancelAtPeriodEnd, iapOriginalTransactionId 追加
- safetyIdentifier（SHA-256）を TranslationConfig に追加

### M-003: 言語ペア検出ロジック

対応: **architecture.md 5.5節に追加**。

- nativeLanguageベースの判定（autoは使わない）
- 同一言語発話時のOpenAI API挙動をPhase 1aで検証
- ambient passthrough 30%で無音問題に対応

### M-004〜M-010: その他

全て上記の修正に含めて対応済み。

---

## 質問への回答

| ID | 回答 |
|----|------|
| Q-001 | GPT-RT-Translateの同時セッション上限は未確認。Phase 1a開始時にOpenAI Dashboardで確認 |
| Q-002 | 法務は外部弁護士に依頼予定。予算・時期は後日 |
| Q-003 | Phase 1cはIAP + MSCA 21%。B2B向けWebサブスク併設 |
| Q-004 | iPhone 15 Pro未満 + Android + B2Bログが主要ターゲット |
| Q-005 | TypeScript第一候補。Phase 1aゲートで判断 |
| Q-006 | OpenAI障害時の手動フェイルオーバー先はPhase 1a技術検証で評価 |
| Q-007 | レビューサイクルは本回で実質終了。次はPhase 1a実装 |
