# CLAUDE.md — apps/translation-agent

## 概要

LiveKit Agents Framework (Node.js 1.0) で実装する翻訳ワーカー。
LiveKit Room に Agent として参加し、各 Participant の `raw-{participantId}` トラックを
Subscribe → OpenAI GPT-Realtime-Translate WebSocket に送出 → 翻訳済み音声を
`trans-{sourceId}-to-{lang}` として Publish する。

## 技術選定（2026年5月時点）

### LiveKit Agents Node.js（@livekit/agents）

- **採用バージョン**: 1.0.x（2025年8月の 1.0 安定リリース後、v1.0.47 が現時点最新、約半年枯らされている）
- **2025年8月以降、`VoicePipelineAgent` / `MultimodalAgent` は deprecated**。新規実装は `AgentSession` ベースで `defineAgent({ entry })` を使う。
- ただし TranCall は LLM 会話 Agent ではなく **音声 In→Out のパススルー翻訳パイプライン**であるため、`voice.AgentSession` の STT/LLM/TTS パイプラインは使わず、`ctx.room` から直接 PCM トラックを処理する。
- 旧設計書にあった「Python livekit-agents への fallback」は **廃止**。理由:
  - Node.js 版 1.0 が正式 GA 済み（"Developer Preview" 表記の根拠が古い）
  - Phase 1a の Sprint 0 で Gate Check スクリプト（`scripts/gate-check.ts`）により安定性を実測し、想定外の問題は Issue 化して対応する方針に変更
  - 言語切替コストよりライブラリ更新の方が安価という判断

### OpenAI GPT-Realtime-Translate

- 2026年5月7日リリース、$0.034/min、入力70+/出力13言語、dynamic voice adaptation（voice 選択不可）
- 接続方式は **WebSocket と WebRTC の2系統**:
  - **WebSocket**（採用）: サーバー側で `wss://api.openai.com/v1/realtime/translations` に直接接続、Agent が PCM フレームを Base64 で送出
  - **WebRTC**（将来検討）: `/v1/realtime/translations/client_secrets` で短命トークンを発行しブラウザ/端末から直接、サンプルレート変換が不要
- Phase 1a Sprint 1 で WebSocket 経路を完成 → Sprint 2 で WebRTC 経路を比較計測し、レイテンシ改善が出れば Phase 1b で切替

## 翻訳パイプライン方式

**Server-side Agent + LiveKit edge network**（確定）。
Client-side sidecar は OpenAI / LiveKit 公式がモバイル長時間動作を非推奨としているため不採用。

## モジュール構成

```
apps/translation-agent/
├── src/
│   ├── index.ts                  # cli.runApp() エントリポイント
│   ├── agent.ts                  # defineAgent({ entry }) 本体
│   ├── translation-session.ts    # 1 言語ペア = 1 翻訳セッションの状態管理
│   ├── openai-ws-client.ts       # GPT-RT-Translate WebSocket クライアント
│   ├── internal-api-client.ts    # Server → Agent HMAC-SHA256 内部 API
│   ├── config.ts                 # 環境変数バリデーション
│   └── logger.ts                 # 構造化ログ
└── scripts/
    └── gate-check.ts             # Phase 1a 終了条件を測定するスクリプト
```

## 依存パッケージ

- `@livekit/agents` ^1.0.47 — Worker / Job / Agent ライフサイクル
- `@livekit/rtc-node` ^0.13.x — LiveKit Room SDK（Node.js native binding）
- `ws` ^8.x — OpenAI Realtime WebSocket クライアント
- `zod` ^4.4.3 — 環境変数 / 内部 API スキーマ
- `@trancall/shared-kernel` — Result 型 / Branded ID / Language enum

`@trancall/media`、`@trancall/translation` の **直接 import は禁止**。
理由: Agent は別プロセスで動作するため、ドメインロジックは内部 API 経由でやり取りする。
共通の型定義が必要な場合は `shared-kernel` 経由のみ許可する。

## デプロイ前提

- **クラウド前提**（オンプレ Proxmox LXC は廃止）
- **LiveKit Cloud**（最初から使う、5,000 participant-min/月 無料枠で Phase 1a 完走可能）
- Agent プロセスのホスティング候補（Sprint 0 で1つ選定）:
  - **Render** — Background Worker、Dockerfile デプロイ、SSE/WebSocket OK
  - **Fly.io** — グローバルリージョン、`fly machine run` でスケール
  - **Google Cloud Run** — Always-on min-instances=1 必須（idle で停止しないモード）
  - Vercel は **不適**（serverless 関数の実行時間制限、WebSocket 常時接続不可）

## Phase 1a 終了条件（Gate Check）

詳細は `scripts/gate-check.ts` を参照。

- [ ] LiveKit Room 参加 → Audio Track Subscribe 成功
- [ ] OpenAI GPT-RT-Translate WebSocket 接続 → 翻訳音声受信成功
- [ ] 翻訳済み Track Publish → 相手クライアントで再生成功
- [ ] 30分連続翻訳セッション安定動作（クラッシュ/ハング率 1% 未満）
- [ ] メモリ使用量 512MB 未満
- [ ] p50 1.5s / p95 3.0s / p99 5.0s のレイテンシ達成
- [ ] Agent crash 時に通話が原音 fallback で継続
- [ ] OpenAI WebSocket 切断後10秒以内に再接続
- [ ] 同一言語発話時の OpenAI API 挙動確認（passthrough か出力抑制か）

## 開発・実行コマンド

```bash
# 環境変数を .env に書く
cp .env.example .env
# 編集後...

# 開発実行
pnpm dev

# Gate Check
pnpm tsx scripts/gate-check.ts

# 本番ビルド
pnpm build && pnpm start
```

## 既知のリスク

| リスク | 影響 | 緩和策 |
|---|---|---|
| `@livekit/rtc-node` の native binding が Apple Silicon Linux Docker で動かない | デプロイ不可 | base image を `node:22-bookworm` に統一、CI で `--platform linux/amd64` ビルド検証 |
| OpenAI Realtime Translation の API スキーマがbreaking changeを起こす | 全停止 | `openai-ws-client.ts` を 1 ファイルにまとめて差し替え可能に |
| 同一 Room に Agent が複数 attach されてしまう（Job 重複） | OpenAI トークン浪費 + 翻訳音声の重複 | LiveKit Server の Job Assignment 機構に従い、Worker 側で `agentName` を Room metadata に登録、重複検出時は片方が graceful shutdown |
