# CLAUDE.md — apps/translation-agent

## 概要

LiveKit Agent Frameworkで実装する翻訳ワーカー。
Roomに参加し音声トラック取得→GPT-RT-Translate WebSocket→翻訳済み音声を再Publish。

## 翻訳パイプライン方式

**server-side Agent + LiveKit edge network**（確定）。
client-side sidecarはOpenAI/LiveKit公式がモバイルでは非推奨のため不採用。

## 言語選定

**TypeScript（@livekit/rtc-node）**を第一候補とする。ただし:

- @livekit/rtc-node は公式に "Developer Preview, not for production" と明記
- Python版 livekit-agents は1.5.x系で安定、プラグイン充実、採用事例多数
- Phase 1aの技術検証で以下を確認:
  - rtc-nodeで30分連続翻訳セッションが安定するか
  - メモリ使用量が512MB未満を維持するか
  - 上記を満たさない場合、Python版に切り替える
- Python版に切り替える場合のmonorepo構成:
  - apps/translation-agent/ をPythonプロジェクトとして再構成
  - Agent↔Server間はHTTP内部API（既に設計済み）で言語非依存
  - Zodスキーマの共有は不要（API境界のJSONスキーマで十分）

## 依存するパッケージ

- @trancall/shared-kernel（TypeScript版の場合のみ）
- LiveKit Agent SDK（@livekit/agents or livekit-agents-python）
- OpenAI Realtime Translation API

## Phase 1a 終了条件

- [ ] LiveKit Room参加→Audio Track Subscribe成功
- [ ] OpenAI GPT-RT-Translate WebSocket接続→翻訳音声受信成功
- [ ] 翻訳済みTrack Publish→相手クライアントで再生成功
- [ ] 30分連続翻訳セッション安定動作
- [ ] メモリ使用量512MB未満
- [ ] p50 1.5s / p95 3.0s / p99 5.0sのレイテンシー達成
- [ ] Agent crash時に通話が原音fallbackで継続
- [ ] 同一言語発話時のOpenAI API挙動確認
